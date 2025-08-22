import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { OperationLog, OperationLogEntry } from '@/lib/types';

type TaskDrawerState = {
  tasks: Record<string, OperationLog>;
  taskOrder: string[];
  currentTaskId: string | null;
  isOpen: boolean;
  isMinimized: boolean;
  actions: {
    startOperation: (title: string, context?: object, triggerType?: 'USER' | 'SYSTEM') => Promise<string>;
    addTask: (task: OperationLog) => void;
    setLogHistory: (taskId: string, entries: OperationLogEntry[]) => void;
    addLogEntry: (taskId: string, entry: OperationLogEntry) => void;
    updateTaskStatus: (taskId: string, status: OperationLog['status'], endTime?: string) => void;
    fetchTasks: () => Promise<void>;
    selectTask: (taskId: string | null) => void;
    toggleOpen: () => void;
    setOpen: (open: boolean) => void;
    toggleMinimize: () => void;
  };
};

export const useTaskDrawerStore = create<TaskDrawerState>()(
  immer((set, get) => ({
    tasks: {},
    taskOrder: [],
    currentTaskId: null,
    isOpen: false,
    isMinimized: false,
    actions: {
      startOperation: async (title, context = {}, triggerType = 'USER') => {
        const res = await fetch('/api/v1/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, context, triggerType }),
        });
        if (!res.ok) {
          throw new Error('Failed to create operation');
        }
        const newTask: OperationLog = await res.json();
        get().actions.addTask(newTask);
        set({
          isOpen: true,
          isMinimized: false,
          currentTaskId: newTask.id,
        });
        return newTask.id;
      },
      addTask: (task) => {
        set((state) => {
          if (!state.tasks[task.id]) {
            state.tasks[task.id] = { ...task, entries: task.entries || [] };
            state.taskOrder.unshift(task.id);
          }
        });
      },
      setLogHistory: (taskId, entries) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].entries = entries;
          }
        });
      },
      addLogEntry: (taskId, entry) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].entries.push(entry);
          }
        });
      },
      updateTaskStatus: (taskId, status, endTime) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].status = status;
            if (endTime) {
              state.tasks[taskId].endTime = endTime;
            }
          }
        });
      },
      fetchTasks: async () => {
        try {
          const res = await fetch('/api/v1/operations');
          if (!res.ok) return;
          const fetchedTasks: OperationLog[] = await res.json();
          set((state) => {
            const newOrder: string[] = [];
            for (const task of fetchedTasks) {
              newOrder.push(task.id);
              const existingTask = state.tasks[task.id];
              // Smarter merging:
              // Always preserve existing entries if they exist.
              // The poll is for metadata updates, not log content.
              if (existingTask) {
                state.tasks[task.id] = {
                  ...existingTask, // Keep old data (especially entries)
                  ...task,         // Overwrite with new metadata (status, endTime)
                };
              } else {
                state.tasks[task.id] = { ...task, entries: task.entries || [] };
              }
            }
            state.taskOrder = newOrder.sort((a, b) => 
              new Date(state.tasks[b].startTime).getTime() - new Date(state.tasks[a].startTime).getTime()
            );
          });
        } catch (error) {
          console.error("Failed to fetch tasks:", error);
        }
      },
      selectTask: (taskId) => {
        set({ currentTaskId: taskId });
      },
      toggleOpen: () => {
        set((state) => ({ isOpen: !state.isOpen }));
      },
      setOpen: (open) => {
        set({ isOpen: open });
      },
      toggleMinimize: () => {
        set((state) => ({ isMinimized: !state.isMinimized }));
      },
    },
  })),
);
