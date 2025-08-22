import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { OperationLog } from '@/lib/types';

type TaskDrawerState = {
  tasks: Record<string, OperationLog>;
  taskOrder: string[];
  currentTaskId: string | null;
  isOpen: boolean;
  isMinimized: boolean;
  actions: {
    startOperation: (title: string, executionType?: 'MANUAL' | 'AUTOMATIC') => Promise<string>;
    addTask: (task: OperationLog) => void;
    setLogHistory: (taskId: string, logs: string) => void;
    addLog: (taskId: string, logChunk: string) => void;
    updateTaskStatus: (taskId: string, status: 'COMPLETED' | 'ERROR' | 'RUNNING', endTime?: number) => void;
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
      startOperation: async (title, executionType = 'MANUAL') => {
        const res = await fetch('/api/v1/operations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, executionType }),
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
            state.tasks[task.id] = task;
            state.taskOrder.unshift(task.id);
          }
        });
      },
      setLogHistory: (taskId, logs) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].logs = logs;
          }
        });
      },
      addLog: (taskId, logChunk) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].logs = (state.tasks[taskId].logs || '') + logChunk;
          }
        });
      },
      updateTaskStatus: (taskId, status, endTime) => {
        set((state) => {
          if (state.tasks[taskId]) {
            state.tasks[taskId].status = status;
            if (endTime) {
              state.tasks[taskId].endTime = new Date(endTime).toISOString();
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
            const newTasks: Record<string, OperationLog> = {};
            const newOrder: string[] = [];
            
            for (const task of fetchedTasks) {
              newOrder.push(task.id);
              // If the task is already in our state and is running, preserve its logs.
              if (state.tasks[task.id] && state.tasks[task.id].status === 'RUNNING') {
                newTasks[task.id] = {
                  ...task,
                  logs: state.tasks[task.id].logs, // Preserve existing logs
                };
              } else {
                newTasks[task.id] = task;
              }
            }
            state.tasks = newTasks;
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