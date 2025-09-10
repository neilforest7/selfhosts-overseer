"use client";

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FolderOpen, 
  File, 
  Home, 
  Server, 
  Database, 
  Settings,
  Archive,
  FileText,
  Image,
  Code
} from 'lucide-react';

interface FilePathSelectorProps {
  value: string;
  onChange: (path: string) => void;
  type?: 'file' | 'directory' | 'both';
  placeholder?: string;
  label?: string;
  description?: string;
}

const COMMON_PATHS = {
  system: [
    { path: '/etc', label: 'System Configuration', icon: <Settings className="h-4 w-4" /> },
    { path: '/var/log', label: 'System Logs', icon: <FileText className="h-4 w-4" /> },
    { path: '/var/lib', label: 'Variable Data', icon: <Database className="h-4 w-4" /> },
    { path: '/opt', label: 'Optional Software', icon: <Archive className="h-4 w-4" /> },
    { path: '/usr/local', label: 'Local Programs', icon: <Code className="h-4 w-4" /> },
    { path: '/tmp', label: 'Temporary Files', icon: <File className="h-4 w-4" /> },
  ],
  user: [
    { path: '/home', label: 'User Home', icon: <Home className="h-4 w-4" /> },
    { path: '/home/user', label: 'User Directory', icon: <Home className="h-4 w-4" /> },
    { path: '/home/user/Documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
    { path: '/home/user/Downloads', label: 'Downloads', icon: <Archive className="h-4 w-4" /> },
  ],
  application: [
    { path: '/var/www', label: 'Web Root', icon: <Server className="h-4 w-4" /> },
    { path: '/var/www/html', label: 'HTML Files', icon: <Code className="h-4 w-4" /> },
    { path: '/etc/nginx', label: 'Nginx Config', icon: <Settings className="h-4 w-4" /> },
    { path: '/etc/apache2', label: 'Apache Config', icon: <Settings className="h-4 w-4" /> },
    { path: '/var/lib/docker', label: 'Docker Data', icon: <Database className="h-4 w-4" /> },
    { path: '/etc/systemd/system', label: 'Systemd Services', icon: <Settings className="h-4 w-4" /> },
  ],
  backup: [
    { path: '/backup', label: 'Backup Directory', icon: <Archive className="h-4 w-4" /> },
    { path: '/var/backups', label: 'System Backups', icon: <Archive className="h-4 w-4" /> },
    { path: '/mnt/backup', label: 'Mounted Backup', icon: <Archive className="h-4 w-4" /> },
  ]
};

const FILE_EXTENSIONS = {
  config: ['.conf', '.config', '.ini', '.yaml', '.yml', '.json', '.toml'],
  log: ['.log', '.out', '.err'],
  script: ['.sh', '.bash', '.py', '.js', '.ts'],
  data: ['.sql', '.db', '.sqlite', '.csv', '.xml'],
  archive: ['.tar', '.gz', '.zip', '.bz2', '.xz'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.svg'],
};

export function FilePathSelector({
  value,
  onChange,
  type = 'both',
  placeholder = 'Enter file or directory path',
  label = 'Path',
  description
}: FilePathSelectorProps) {
  // Ensure value is always a string to prevent runtime errors
  const safeValue = typeof value === 'string' ? value : '';

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handlePathSelect = (path: string) => {
    onChange(path);
    setShowSuggestions(false);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setShowSuggestions(true);
  };

  const getPathIcon = (path: string) => {
    if (path.includes('/log')) return <FileText className="h-4 w-4" />;
    if (path.includes('/etc')) return <Settings className="h-4 w-4" />;
    if (path.includes('/var/www')) return <Server className="h-4 w-4" />;
    if (path.includes('/home')) return <Home className="h-4 w-4" />;
    if (path.includes('/backup')) return <Archive className="h-4 w-4" />;
    if (path.includes('/opt')) return <Code className="h-4 w-4" />;
    return <FolderOpen className="h-4 w-4" />;
  };

  const getFileTypeFromPath = (path: string) => {
    const extension = path.substring(path.lastIndexOf('.'));
    for (const [category, extensions] of Object.entries(FILE_EXTENSIONS)) {
      if (extensions.includes(extension)) {
        return category;
      }
    }
    return 'file';
  };

  const validatePath = (path: string) => {
    // Ensure path is a string
    if (!path || typeof path !== 'string') return null;
    if (!path.startsWith('/')) return 'Path should start with /';
    if (path.includes('..')) return 'Path should not contain ..';
    if (path.includes('//')) return 'Path should not contain //';
    return null;
  };

  const pathError = validatePath(safeValue);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>{label}</Label>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {/* Path Input */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              value={safeValue}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={pathError ? 'border-red-500' : ''}
            />
            {safeValue && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                {getPathIcon(safeValue)}
              </div>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowSuggestions(!showSuggestions)}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        </div>
        
        {pathError && (
          <p className="text-sm text-red-500">{pathError}</p>
        )}
      </div>

      {/* Path Type and Category Selector */}
      {showSuggestions && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Common Paths</CardTitle>
            <CardDescription>
              Select from commonly used paths or browse by category
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Category Selector */}
            <div className="space-y-2">
              <Label className="text-xs">Category</Label>
              <Select value={selectedCategory} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System Paths</SelectItem>
                  <SelectItem value="user">User Paths</SelectItem>
                  <SelectItem value="application">Application Paths</SelectItem>
                  <SelectItem value="backup">Backup Paths</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Path Suggestions */}
            {selectedCategory && (
              <div className="space-y-2">
                <Label className="text-xs">Suggested Paths</Label>
                <div className="grid grid-cols-1 gap-1 max-h-48 overflow-y-auto">
                  {COMMON_PATHS[selectedCategory as keyof typeof COMMON_PATHS]?.map((item) => (
                    <Button
                      key={item.path}
                      variant="ghost"
                      className="justify-start h-auto p-2"
                      onClick={() => handlePathSelect(item.path)}
                    >
                      <div className="flex items-center gap-2 w-full">
                        {item.icon}
                        <div className="flex-1 text-left">
                          <div className="font-mono text-sm">{item.path}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.label}
                          </div>
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Path Info */}
      {safeValue && !pathError && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {getPathIcon(safeValue)}
          <span>
            {type === 'file' && safeValue.includes('.') && (
              <Badge variant="outline" className="text-xs mr-2">
                {getFileTypeFromPath(safeValue)}
              </Badge>
            )}
            {safeValue.endsWith('/') ? 'Directory' : 'File'}
          </span>
        </div>
      )}
    </div>
  );
}
