import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
  Button,
} from 'canonical';

// Rendered open (defaultOpen) so the card captures the confirmation, not the
// trigger. AlertDialog is the BLOCKING confirm (vs Dialog's dismissible modal):
// AlertDialogAction is the primary button, AlertDialogCancel the outline one —
// they ARE the footer buttons, no separate Button needed. A destructive,
// irreversible action is the canonical use.
export function Open() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete workspace</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “Procurement — TW Group”?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the workspace and its 1,240 indexed
            sources. Linked bid answers lose their provenance, and this cannot
            be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep workspace</AlertDialogCancel>
          <AlertDialogAction>Delete permanently</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
