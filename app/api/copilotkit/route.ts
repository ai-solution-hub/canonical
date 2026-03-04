import {
  CopilotRuntime,
  AnthropicAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from '@copilotkit/runtime';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, unauthorisedResponse, rateLimitResponse } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { getAnthropicClient, getModelForTier } from '@/lib/anthropic';

export const POST = async (req: NextRequest) => {
  try {
    // Auth guard: require admin or editor role
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return unauthorisedResponse();

    // Rate limit: 60 messages per minute per user
    const { allowed } = checkRateLimit(`copilotkit:${auth.user.id}`, 60, 60_000);
    if (!allowed) return rateLimitResponse();

    // Create runtime per-request to avoid stale state and ensure fresh env vars
    const serviceAdapter = new AnthropicAdapter({
      anthropic: getAnthropicClient(),
      model: getModelForTier('drafting'),
      promptCaching: {
        enabled: true,
        debug: process.env.NODE_ENV === 'development',
      },
    });

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
