import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  Button,
} from 'canonical';

export function InContext() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Filter sources</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Freshness</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Fresh</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked>Ageing</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem>Stale</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Coverage</DropdownMenuLabel>
        <DropdownMenuItem>High relevance only</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
