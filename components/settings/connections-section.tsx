'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Search,
  LayoutDashboard,
  Target,
  Compass,
  FileText,
  BarChart3,
  Info,
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import { BRANDING } from '@/lib/client-config';
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
import { useUserRole } from '@/hooks/use-user-role';

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
  const { canAdmin } = useUserRole();

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
                Connect {BRANDING.productName} to Claude so you can search,
                draft, and get briefings from any conversation. Copy the server
                URL below and paste it into Claude.ai Settings &gt; Connectors.
                The &ldquo;Connected apps&rdquo; list below shows which Claude
                instances have access — you can revoke any connection at any
                time.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </h3>
        <p className="text-sm text-muted-foreground">
          Connect {BRANDING.productName} to Claude so you can search, draft, and
          get briefings from any conversation.
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-url">MCP server endpoint</Label>
            <div className="flex items-center gap-2">
              <Input
                id="mcp-url"
                type="text"
                value={mcpUrl}
                readOnly
                aria-readonly="true"
                className="bg-muted font-mono text-sm"
              />
              <CopyButton value={mcpUrl} label="Copy MCP server endpoint URL" />
            </div>
            <p className="text-xs text-muted-foreground">
              Paste into{' '}
              <span className="font-medium text-foreground">
                Claude.ai &rarr; Settings &rarr; Connectors &rarr; Add connector
              </span>
              . The URL ends with{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                /mcp
              </code>{' '}
              — that&rsquo;s the streamable-HTTP transport identifier, not a
              typo.
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

      {/* For developers — admin only */}
      {canAdmin && (
        <>
          <Separator />
          <Accordion type="single" collapsible>
            <AccordionItem value="for-developers" className="border-b-0">
              <AccordionTrigger className="text-base font-semibold">
                <span className="flex items-center gap-2">
                  <Terminal className="size-4" aria-hidden="true" />
                  For developers
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-6 pt-2">
                  {/* Plugin download */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Claude Code Plugin</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <p className="text-sm text-muted-foreground">
                        Download the {BRANDING.productName} plugin for Claude
                        Code or Cowork. Adds slash commands for searching your
                        knowledge base, checking bid status, and drafting
                        responses.
                      </p>
                      <div className="flex flex-col gap-3">
                        <Button variant="outline" className="w-fit" asChild>
                          <a href="/api/plugin/download" download>
                            <Download
                              className="mr-2 size-4"
                              aria-hidden="true"
                            />
                            Download Plugin
                          </a>
                        </Button>
                        <ol
                          className="flex list-none flex-col gap-1.5 text-sm text-muted-foreground"
                          role="list"
                        >
                          <li className="flex gap-2">
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                              1
                            </span>
                            <span>Download the plugin file</span>
                          </li>
                          <li className="flex gap-2">
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                              2
                            </span>
                            <span>
                              Open{' '}
                              <span className="font-medium text-foreground">
                                Claude Desktop
                              </span>{' '}
                              or{' '}
                              <span className="font-medium text-foreground">
                                Cowork
                              </span>
                            </span>
                          </li>
                          <li className="flex gap-2">
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                              3
                            </span>
                            <span>
                              Go to Settings &rarr; Plugins &rarr; Upload
                            </span>
                          </li>
                          <li className="flex gap-2">
                            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                              4
                            </span>
                            <span>Select the downloaded file</span>
                          </li>
                        </ol>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Claude Code / .mcp.json setup */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Terminal className="size-5" aria-hidden="true" />
                        Claude Code
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <p className="text-sm text-muted-foreground">
                        Using Claude Code? The MCP connector works there too.
                        Add it to your project&apos;s MCP configuration to
                        access {BRANDING.productName} tools directly from the
                        terminal.
                      </p>

                      <div className="flex flex-col gap-1.5">
                        <p
                          id="mcp-config-label"
                          className="text-sm font-medium leading-none"
                        >
                          MCP configuration (paste into{' '}
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                            .mcp.json
                          </code>
                          )
                        </p>
                        <div className="flex items-start gap-2">
                          <pre
                            aria-labelledby="mcp-config-label"
                            className="flex-1 overflow-x-auto rounded-md border bg-muted px-4 py-3 font-mono text-sm"
                          >{`{
  "mcpServers": {
    "knowledge-hub": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`}</pre>
                          <CopyButton
                            value={`{\n  "mcpServers": {\n    "knowledge-hub": {\n      "type": "http",\n      "url": "${mcpUrl}"\n    }\n  }\n}`}
                            label="Copy MCP configuration"
                          />
                        </div>
                      </div>

                      <Accordion type="single" collapsible>
                        <AccordionItem
                          value="claude-code-setup"
                          className="border-b-0"
                        >
                          <AccordionTrigger>
                            Step-by-step instructions
                          </AccordionTrigger>
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
                                  Create a{' '}
                                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                                    .mcp.json
                                  </code>{' '}
                                  file in your project root (or add to an
                                  existing one)
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                  2
                                </span>
                                <span>Paste the configuration above</span>
                              </li>
                              <li className="flex gap-2">
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                  3
                                </span>
                                <span>
                                  Start Claude Code &mdash; run{' '}
                                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                                    claude
                                  </code>{' '}
                                  in your terminal
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                  4
                                </span>
                                <span>
                                  Approve the MCP server connection when
                                  prompted
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                  5
                                </span>
                                <span>
                                  Authenticate via the browser when the OAuth
                                  consent page opens
                                </span>
                              </li>
                              <li className="flex gap-2">
                                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                                  6
                                </span>
                                <span>
                                  {BRANDING.productName} tools are now available
                                  &mdash; try{' '}
                                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                                    /mcp
                                  </code>{' '}
                                  to see connected tools
                                </span>
                              </li>
                            </ol>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>

                      <p className="text-xs text-muted-foreground">
                        Optionally, download the plugin above for slash commands
                        and bid-writing skills. Place the extracted plugin
                        folder in{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                          ~/.claude/plugins/marketplaces/local/plugins/knowledge-hub/
                        </code>{' '}
                        and restart Claude Code.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </div>
  );
}
