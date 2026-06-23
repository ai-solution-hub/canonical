import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from 'canonical';

const muted: React.CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: 14,
};

export function Single() {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue="coverage"
      style={{ width: 380 }}
    >
      <AccordionItem value="coverage">
        <AccordionTrigger>How is coverage calculated?</AccordionTrigger>
        <AccordionContent>
          <p style={muted}>
            Coverage is the share of required questions with a verified answer,
            weighted by section.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="freshness">
        <AccordionTrigger>What makes a source stale?</AccordionTrigger>
        <AccordionContent>
          <p style={muted}>
            Sources past their freshness window, or superseded by a newer
            document, are flagged for review.
          </p>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="provenance">
        <AccordionTrigger>Where does an answer come from?</AccordionTrigger>
        <AccordionContent>
          <p style={muted}>
            Every answer links to its source passages — open provenance to trace
            the evidence.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
