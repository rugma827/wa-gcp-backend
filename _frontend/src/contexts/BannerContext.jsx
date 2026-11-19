import { createContext, useContext } from 'react';
import useMorningNotes from '../hooks/useMorningNotes';
import useCIAData from '../hooks/useCIAData';

const BannerContext = createContext(null);

export function BannerProvider({ children }) {
  const morningNotes = useMorningNotes();
  const ciaData = useCIAData();

  return (
    <BannerContext.Provider value={{ morningNotes, ciaData }}>
      {children}
    </BannerContext.Provider>
  );
}

export function useBanner() {
  return useContext(BannerContext);
}
