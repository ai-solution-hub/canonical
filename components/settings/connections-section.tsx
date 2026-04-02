'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  Search,
  LayoutDashboard,
  Target,
  Compass,
  FileText,
  BarChart3,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ConnectedAppsSection } from '@/components/settings/connected-apps-section';
import { getMcpUrl } from '@/components/settings/mcp-url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CAPABILITIES = [
  { icon: Search, text: 'Search your knowledge base' },
  { icon: LayoutDashboard, text: 'Get a dashboard summary' },
  { icon: Target, text: 'Check active bid status and deadlines' },
  { icon: Compass, text: 'Get a personal reorientation briefing' },
  { icon: FileText, text: 'Draft bid responses using KB content' },
  { icon: BarChart3, text: 'View quality and freshness reports' },
];

const QUICK_START_PROMPTS = [
  'Search my knowledge base for health and safety policies',
  'Give me a briefing on what\u2019s changed since I was last active',
  'What\u2019s the status of our active bids?',
  'Draft a response about our ISO 27001 certification',
];

// ---------------------------------------------------------------------------
// Copy button with feedback
// ---------------------------------------------------------------------------

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label={label}
      className="shrink-0"
    >
      {copied ? (
        <Check className="mr-1.5 size-3.5" />
      ) : (
        <Copy className="mr-1.5 size-3.5" />
      )}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Connections Section
// ---------------------------------------------------------------------------

export function ConnectionsSection() {
  const mcpUrl = getMcpUrl();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          Connections
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="More information about connections"
                >
                  <Info className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Claude can search your knowledge base, check bid status, and
                draft responses when connected via MCP. Copy the server URL and
                paste it into Claude.ai Settings &gt; Connectors. Connected apps
                show which Claude instances have access — you can revoke any
                connection.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h3>
        <p className="text-sm text-muted-foreground">
          Connect your Knowledge Hub to Claude so you can search, draft, and get
          briefings from any conversation.
        </p>
      </div>

      {/* Connected apps (OAuth grants) — user-facing, shown first */}
      <ConnectedAppsSection />

      <Separator />

      {/* Connect to Claude */}
      <Card>
        <CardHeader>
          <CardTitle>Connect to Claude</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Connect your Knowledge Hub to Claude to search your knowledge base,
            check bid status, and get briefings directly from Claude.
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-url">MCP Server URL</Label>
            <div className="flex items-center gap-2">
              <Input
                id="mcp-url"
                type="text"
                value={mcpUrl}
                readOnly
                aria-readonly="true"
                className="bg-muted font-mono text-sm"
              />
              <CopyButton value={mcpUrl} label="Copy MCP server URL" />
            </div>
            <p className="text-xs text-muted-foreground">
              Use this URL to connect Claude to your Knowledge Hub via MCP.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* How to connect */}
      <Card>
        <CardHeader>
          <CardTitle>How to connect</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="how-to-connect" className="border-b-0">
              <AccordionTrigger>Step-by-step instructions</AccordionTrigger>
              <AccordionContent>
                <ol
                  className="flex list-none flex-col gap-3 text-sm text-muted-foreground"
                  role="list"
                >
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      1
                    </span>
                    <span>
                      Go to{' '}
                      <span className="font-medium text-foreground">
                        Claude.ai
                      </span>{' '}
                      &rarr; Settings &rarr; Connectors
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      2
                    </span>
                    <span>
                      Click{' '}
                      <span className="font-medium text-foreground">
                        &ldquo;Add connector&rdquo;
                      </span>
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      3
                    </span>
                    <span>Paste the MCP server URL from above</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      4
                    </span>
                    <span>Approve access on the consent page</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      5
                    </span>
                    <span>Start using tools in any conversation</span>
                  </li>
                </ol>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* What you can do */}
      <Card>
        <CardHeader>
          <CardTitle>What you can do</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2.5" role="list">
            {CAPABILITIES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2.5 text-sm">
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Separator />

      {/* Quick start prompts */}
      <div>
        <h3 className="mb-1 text-base font-semibold">Quick start prompts</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Try these prompts after connecting to get started quickly.
        </p>
        <ul className="flex flex-col gap-2">
          {QUICK_START_PROMPTS.map((prompt) => (
            <li
              key={prompt}
              className="flex items-center justify-between gap-3 rounded-lg border bg-muted/50 px-4 py-3"
            >
              <p className="text-sm italic text-foreground">
                &ldquo;{prompt}&rdquo;
              </p>
              <CopyButton value={prompt} label={`Copy prompt: ${prompt}`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
