import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { createAnthropic } from '@ai-sdk/anthropic';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';

export const maxDuration = 60;

export const POST = async (req: NextRequest) => {
  try {
    // Auth guard: require admin or editor role
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);

    // Rate limit: 10 requests per minute per user.
    // CopilotKit fires parallel suggestion requests on every navigation —
    // the tight limit acts as server-side burst protection, reducing API costs
    // by ~90% while keeping the feature functional.
    const rl = checkRateLimit(`copilotkit:${auth.user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.resetAt);

    // Use Haiku for CopilotKit — suggestions generate ~130 output tokens
    // and don't need Opus quality. Override with AI_COPILOTKIT_MODEL env var.
    const model = process.env.AI_COPILOTKIT_MODEL ?? 'claude-haiku-4-5';
    const serviceAdapter = new AnthropicAdapter({ model });

    // Fix: CopilotKit's AnthropicAdapter.getLanguageModel() passes the wrong
    // baseURL to @ai-sdk/anthropic (https://api.anthropic.com instead of
    // https://api.anthropic.com/v1), causing a 404. Override to use the
    // @ai-sdk/anthropic provider directly with the correct default baseURL.
    serviceAdapter.getLanguageModel = () => {
      return createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY!,
      })(model);
    };

    const runtime = new CopilotRuntime();

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: '/api/copilotkit',
    });

    return handleRequest(req);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'CopilotKit request failed') },
      { status: 500 },
    );
  }
};
