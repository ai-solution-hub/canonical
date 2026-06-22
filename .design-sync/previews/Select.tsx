import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from 'canonical';

// Rendered open (defaultOpen) so the card captures the listbox, not just the
// closed trigger. Groups + label + separator exercise the full composition.
export function Open() {
  return (
    <Select defaultOpen defaultValue="editor">
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue placeholder="Select a role" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Workspace role</SelectLabel>
          <SelectItem value="viewer">Viewer</SelectItem>
          <SelectItem value="editor">Editor</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Access</SelectLabel>
          <SelectItem value="owner">Owner</SelectItem>
          <SelectItem value="billing">Billing contact</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
