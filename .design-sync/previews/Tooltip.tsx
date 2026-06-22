import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Button,
} from 'canonical';

export function Default() {
  return (
    <TooltipProvider>
      <Tooltip defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="outline">Coverage</Button>
        </TooltipTrigger>
        <TooltipContent>
          Share of required questions with a verified answer.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
