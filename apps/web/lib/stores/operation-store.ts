import { create } from 'zustand';

type Status = 'running' | 'completed' | 'error';
type ExecutionType = 'manual' | 'automatic';

type OperationState = {
  opId: string | null;
  opTitle: string;
  logs: string[];
  isOpen: boolean;
  isMinimized: boolean;
  startTime: number | null;
  endTime: number | null;
  status: Status;
  executionType: ExecutionType;
  startOperation: (opId: string, opTitle: string, executionType?: ExecutionType) => void;
  addLog: (log: string) => void;
  endOperation: (log: string) => void;
  failOperation: (log: string) => void;
  close: () => void;
  toggleMinimize: () => void;
  setOpen: (isOpen: boolean) => void;
};

export const useOperationStore = create<OperationState>((set) => ({
  opId: null,
  opTitle: '',
  logs: [],
  isOpen: false,
  isMinimized: false,
  startTime: null,
  endTime: null,
  status: 'running',
  executionType: 'manual',
  startOperation: (opId, opTitle, executionType = 'manual') =>
    set({
      opId,
      opTitle,
      executionType,
      logs: [`--- 开始于: ${new Date().toLocaleString()} ---`],
      isOpen: true,
      isMinimized: false,
      startTime: Date.now(),
      endTime: null,
      status: 'running',
    }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  endOperation: (log) =>
    set((state) => ({
      logs: [...state.logs, log],
      endTime: Date.now(),
      status: 'completed',
    })),
  failOperation: (log) =>
    set((state) => ({
      logs: [...state.logs, `[ERROR] ${log}`],
      endTime: Date.now(),
      status: 'error',
    })),
  close: () =>
    set({
      opId: null,
      opTitle: '',
      logs: [],
      isOpen: false,
      isMinimized: false,
      startTime: null,
      endTime: null,
    }),
  toggleMinimize: () => set((state) => ({ isMinimized: !state.isMinimized })),
  setOpen: (isOpen) => set({ isOpen }),
}));
