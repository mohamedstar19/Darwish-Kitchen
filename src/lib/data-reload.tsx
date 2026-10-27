import { createContext, useContext } from 'react';

/** Bumped after a restore so every data provider re-reads device storage. */
export const DataGenerationContext = createContext<{ generation: number; reload: () => void }>({
  generation: 0,
  reload: () => {},
});

export const useReloadData = () => useContext(DataGenerationContext).reload;
export const useDataGeneration = () => useContext(DataGenerationContext).generation;
