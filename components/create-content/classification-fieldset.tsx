'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ClassificationFieldsetProps {
  primaryDomain: string;
  setPrimaryDomain: (value: string) => void;
  primarySubtopic: string;
  setPrimarySubtopic: (value: string) => void;
  keywordsInput: string;
  setKeywordsInput: (value: string) => void;
  domainNames: string[];
  subtopicNames: string[];
  formatDomainName: (name: string) => string;
  formatSubtopic: (name: string) => string;
}

/**
 * Classification fieldset for the create content form.
 * Contains domain, subtopic, and keywords fields.
 */
export function ClassificationFieldset({
  primaryDomain,
  setPrimaryDomain,
  primarySubtopic,
  setPrimarySubtopic,
  keywordsInput,
  setKeywordsInput,
  domainNames,
  subtopicNames,
  formatDomainName,
  formatSubtopic,
}: ClassificationFieldsetProps) {
  const handleKeywordsKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  };

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-2 text-sm font-semibold text-muted-foreground">
        Classification
      </legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="domain">Domain</Label>
          <Select value={primaryDomain} onValueChange={setPrimaryDomain}>
            <SelectTrigger id="domain">
              <SelectValue placeholder="Select domain..." />
            </SelectTrigger>
            <SelectContent>
              {domainNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {formatDomainName(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subtopic">Subtopic</Label>
          <Select
            value={primarySubtopic}
            onValueChange={setPrimarySubtopic}
            disabled={!primaryDomain}
          >
            <SelectTrigger id="subtopic">
              <SelectValue
                placeholder={
                  primaryDomain ? 'Select subtopic...' : 'Select domain first'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {subtopicNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {formatSubtopic(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="keywords">
          Keywords{' '}
          <span className="text-xs text-muted-foreground">
            (comma-separated)
          </span>
        </Label>
        <Input
          id="keywords"
          value={keywordsInput}
          onChange={(e) => setKeywordsInput(e.target.value)}
          onKeyDown={handleKeywordsKeyDown}
          placeholder="Add keywords (comma-separated)..."
        />
      </div>
    </fieldset>
  );
}
