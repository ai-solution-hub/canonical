'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type CopilotPage =
  | 'homepage'
  | 'browse'
  | 'library'
  | 'item-detail'
  | 'bid-session'
  | 'bid-detail'
  | 'review'
  | 'coverage'
  | 'search'
  | 'settings'
  | 'unknown';

interface CopilotPageContextValue {
  page: CopilotPage;
  setPage: (page: CopilotPage) => void;
  pageMetadata: Record<string, string>;
  setPageMetadata: (metadata: Record<string, string>) => void;
}

const CopilotPageContext = createContext<CopilotPageContextValue>({
  page: 'unknown',
  setPage: () => {},
  pageMetadata: {},
  setPageMetadata: () => {},
});

export function CopilotPageContextProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState<CopilotPage>('unknown');
  const [pageMetadata, setPageMetadata] = useState<Record<string, string>>({});

  return (
    <CopilotPageContext.Provider value={{ page, setPage, pageMetadata, setPageMetadata }}>
      {children}
    </CopilotPageContext.Provider>
  );
}

export function useCopilotPageContext() {
  return useContext(CopilotPageContext);
}
