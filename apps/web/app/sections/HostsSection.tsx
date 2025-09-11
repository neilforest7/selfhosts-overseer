"use client";

import * as React from "react";
import { useState, useMemo } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconDotsVertical,
  IconGripVertical,
  IconLayoutColumns,
  IconPlus,
} from "@tabler/icons-react";
import {
  ColumnDef,
  ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  Row,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from 'sonner';
import { HostStatusIndicator } from '@/components/HostStatusIndicator';
import { HostEditDialog } from '@/components/HostEditDialog';
import { useHostConnectivity, HostStatus } from '@/lib/hooks/useHostConnectivity';
import { apiClient } from '@/src/lib/api-client';

type Host = {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  port?: number;
  tags?: string[];
  role?: 'local' | 'remote';
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
  status: HostStatus;
  lastConnectivityCheck?: string | Date | null;
};

// Create a separate component for the drag handle
function DragHandle({ id }: { id: string }) {
  const { attributes, listeners } = useSortable({
    id,
  })

  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="text-muted-foreground size-7 hover:bg-transparent"
    >
      <IconGripVertical className="text-muted-foreground size-3" />
      <span className="sr-only">Drag to reorder</span>
    </Button>
  )
}

// Separate component for actions cell
function ActionsCell({ row, onEdit }: { row: Row<Host>; onEdit: (host: Host) => void }) {
  const qc = useQueryClient();
  const { getHostConnectivity } = useHostConnectivity();
  const connectivity = getHostConnectivity(row.original.id);
  const [testing, setTesting] = React.useState(false);
  
  const testConnection = async () => {
    setTesting(true);
    try {
      toast.info(`正在测试连接：${row.original.name}`);
      const response = await apiClient.post(`/api/v1/hosts/${row.original.id}/test-connection`, {});
      if (response.success) {
        toast.success(`连通性正常：${row.original.name}`);
      } else {
        const detail = ((response.data as any)?.stderr || (response.data as any)?.stdout || '').toString().slice(0, 200);
        toast.error(`连通性失败：${row.original.name} - ${detail || '请检查地址/端口/认证方式'}`);
      }
    } catch (error) {
      toast.error(`测试连接时发生错误：${row.original.name}`);
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    const response = await apiClient.delete(`/api/v1/hosts/${row.original.id}`);
    if (!response.success) {
      toast.error(`删除失败: ${response.error}`);
      return;
    }

    toast.success(`主机已删除: ${row.original.name}`);
    qc.invalidateQueries({ queryKey: ['hosts'] });
  };

  return (
    <div className="text-right space-x-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="data-[state=open]:bg-muted text-muted-foreground flex size-8"
            size="icon"
          >
            <IconDotsVertical />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={() => onEdit(row.original)}>
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem onClick={testConnection} disabled={testing}>
            测试连接
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}


function DraggableRow({ row }: { row: Row<Host> }) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  });

  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell: any) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}

export default function HostsSection() {
  const qc = useQueryClient();
  const [tag, setTag] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);

  const handleEditHost = (host: Host) => {
    setEditingHost(host);
    setEditDialogOpen(true);
  };

  const columns = React.useMemo<ColumnDef<Host>[]>(() => [
    {
      id: "drag",
      header: () => null,
      cell: ({ row }: { row: Row<Host> }) => <DragHandle id={row.original.id} />,
    },
    {
      id: "select",
      header: ({ table }: { table: any }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
            aria-label="Select all"
          />
        </div>
      ),
      cell: ({ row }: { row: Row<Host> }) => (
        <div className="flex items-center justify-center">
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "name",
      header: "名称",
      cell: ({ row }: { row: Row<Host> }) => (
        <div className="font-medium">{row.original.name}</div>
      ),
    },
    {
      accessorKey: "address",
      header: "地址",
      cell: ({ row }: { row: Row<Host> }) => (
        <div className="text-muted-foreground">{row.original.address}</div>
      ),
    },
    {
      accessorKey: "status",
      header: "状态",
      cell: ({ row }: { row: Row<Host> }) => {
        const hostId = row.original.id;
        const { getHostConnectivity } = useHostConnectivity();
        const connectivity = getHostConnectivity(hostId);
        
        return (
          <HostStatusIndicator
            status={connectivity?.status || row.original.status || 'UNKNOWN'}
            responseTime={connectivity?.responseTime}
            lastChecked={connectivity?.lastChecked || row.original.lastConnectivityCheck || undefined}
            lastOnline={connectivity?.lastOnline}
            lastOffline={connectivity?.lastOffline}
            errorMessage={connectivity?.errorMessage}
            variant="compact"
          />
        );
      },
    },
    {
      accessorKey: "role",
      header: "角色",
      cell: ({ row }: { row: Row<Host> }) => (
        <Badge variant={row.original.role === 'remote' ? 'secondary' : 'secondary'}>
          {row.original.role === 'remote' ? '公网' : '内网'}
        </Badge>
      ),
    },
    {
      accessorKey: "sshUser",
      header: "用户",
      cell: ({ row }: { row: Row<Host> }) => (
        <div className="text-muted-foreground">{row.original.sshUser}</div>
      ),
    },
    {
      accessorKey: "tags",
      header: "标签",
      cell: ({ row }: { row: Row<Host> }) => (
        <div className="space-x-1">
          {(row.original.tags || []).map((t: string) => (
            <Badge variant="secondary" key={t}>{t}</Badge>
          ))}
          {(row.original.hasPrivateKey || row.original.hasPassword) ? (
            <Badge variant="secondary" className="inline-flex items-center text-xs">已存在凭据</Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">操作</div>,
      cell: ({ row }: { row: Row<Host> }) => <ActionsCell row={row} onEdit={handleEditHost} />,
    },
  ], []);

  const [rowSelection, setRowSelection] = React.useState({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  });
  
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  );

  const hostsQuery = useQuery({
    queryKey: ['hosts', tag, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tag) params.set('tag', tag);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      
      const response = await apiClient.get<{ items: Host[]; nextCursor: string | null }>(`/api/v1/hosts?${params.toString()}`);
      if (!response.success) throw new Error(response.error || '加载失败');
      return response.data;
    }
  });

  const data = React.useMemo(() => hostsQuery.data?.items || [], [hostsQuery.data?.items]);
  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row: Host) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      const oldIndex = dataIds.indexOf(active.id)
      const newIndex = dataIds.indexOf(over.id)
      // Note: This would require updating the data state and backend
      // For now, we'll just show the drag functionality
    }
  }

  
  const bulkDelete = async () => {
    const selectedIds = Object.keys(rowSelection);
    for (const id of selectedIds) {
      // eslint-disable-next-line no-await-in-loop
      const response = await apiClient.delete(`/api/v1/hosts/${id}`);
      if (!response.success) throw new Error(response.error || `删除失败: ${id}`);
    }
    toast.success(`已删除 ${selectedIds.length} 项`);
    setRowSelection({});
    qc.invalidateQueries({ queryKey: ['hosts'] });
  };

  return (
    <>
      <Card>
      <CardHeader>
        <CardTitle>主机</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="按标签筛选" className="max-w-xs"/>
            <Button variant="outline" size="sm">
              <IconLayoutColumns />
              <span className="hidden lg:inline">自定义列</span>
              <IconChevronDown />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {table
                  .getAllColumns()
                  .filter(
                    (column) =>
                      typeof column.accessorFn !== "undefined" &&
                      column.getCanHide()
                  )
                  .map((column: any) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {column.id}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setDialogOpen(true)}>
              <IconPlus />
              <span className="hidden lg:inline">新建主机</span>
            </Button>
            <HostEditDialog
              open={dialogOpen}
              onOpenChange={setDialogOpen}
              host={null}
              mode="create"
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ['hosts'] });
              }}
            />
            <Button variant="secondary" onClick={bulkDelete} disabled={!Object.keys(rowSelection).length}>
              删除所选
            </Button>
          </div>
        </div>
        
        <div className="overflow-hidden rounded-lg border">
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <Table>
              <TableHeader className="bg-muted sticky top-0 z-10">
                {table.getHeaderGroups().map((headerGroup: any) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header: any) => {
                      return (
                        <TableHead key={header.id} colSpan={header.colSpan}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row: any) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center"
                    >
                      没有数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
        </div>

        <div className="flex items-center justify-between px-4">
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {table.getFilteredSelectedRowModel().rows.length} of{" "}
            {table.getFilteredRowModel().rows.length} row(s) selected.
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                每页行数
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
              >
                <SelectTrigger className="w-20 h-8" id="rows-per-page">
                  <SelectValue
                    placeholder={table.getState().pagination.pageSize}
                  />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 20, 30, 40, 50].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              第 {table.getState().pagination.pageIndex + 1} 页，共{" "}
              {table.getPageCount()} 页
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">第一页</span>
                <IconChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">上一页</span>
                <IconChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">下一页</span>
                <IconChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">最后一页</span>
                <IconChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <HostEditDialog
      open={editDialogOpen}
      onOpenChange={setEditDialogOpen}
      host={editingHost}
      onSuccess={() => {
        // Refresh the hosts data after successful edit
        qc.invalidateQueries({ queryKey: ['hosts'] });
      }}
    />
    </>
  );
}