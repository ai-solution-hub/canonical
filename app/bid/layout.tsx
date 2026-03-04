import { CopilotKitProvider } from '@/components/copilotkit-provider';

export default function BidLayout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKitProvider>
      {children}
    </CopilotKitProvider>
  );
}
