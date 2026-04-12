'use client';

import { useState } from 'react';
import { Check, Copy, Download, Terminal } from 'lucide-react';
import { BRANDING } from '@/lib/client-config';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { getMcpUrl } from '@/components/settings/mcp-url';

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
// Developer Setup Section
// ---------------------------------------------------------------------------

export function DeveloperSetupSection() {
  const mcpUrl = getMcpUrl();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-base font-semibold">Developer Setup</h3>
        <p className="text-sm text-muted-foreground">
          Technical configuration for Claude Code, plugin installation, and MCP
          server details.
        </p>
      </div>

      {/* Download plugin */}
      <Card>
        <CardHeader>
          <CardTitle>Claude Code Plugin</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Download the {BRANDING.productName} plugin for Claude Code or Cowork. Adds
            slash commands for searching your knowledge base, checking bid
            status, and drafting responses.
          </p>

          <div className="flex flex-col gap-3">
            <Button variant="outline" className="w-fit" asChild>
              <a href="/api/plugin/download" download>
                <Download className="mr-2 size-4" aria-hidden="true" />
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
                  or <span className="font-medium text-foreground">Cowork</span>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                  3
                </span>
                <span>Go to Settings &rarr; Plugins &rarr; Upload</span>
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

      {/* Claude Code setup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-5" aria-hidden="true" />
            Claude Code
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Using Claude Code? The MCP connector works there too. Add it to your
            project&apos;s MCP configuration to access {BRANDING.productName} tools
            directly from the terminal.
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
            <AccordionItem value="claude-code-setup" className="border-b-0">
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
                      Create a{' '}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                        .mcp.json
                      </code>{' '}
                      file in your project root (or add to an existing one)
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
                    <span>Approve the MCP server connection when prompted</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      5
                    </span>
                    <span>
                      Authenticate via the browser when the OAuth consent page
                      opens
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                      6
                    </span>
                    <span>
                      {BRANDING.productName} tools are now available &mdash; try{' '}
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
            Optionally, download the plugin above for slash commands and
            bid-writing skills. Place the extracted plugin folder in{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              ~/.claude/plugins/marketplaces/local/plugins/knowledge-hub/
            </code>{' '}
            and restart Claude Code.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
