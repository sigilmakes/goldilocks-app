import { useRef } from 'react';
import FileBrowser from '../workspace/FileBrowser';
import { useFilesStore } from '../../store/files';
import { useToastStore } from '../../store/toast';

interface WorkspaceSidebarProps {
  selectedPath: string | null;
  onOpenPath: (path: string) => void;
  onNavigate?: () => void;
}

export default function WorkspaceSidebar({ selectedPath, onOpenPath, onNavigate }: WorkspaceSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useFilesStore((s) => s.upload);
  const addToast = useToastStore((s) => s.addToast);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files) return;

    for (const file of Array.from(files)) {
      try {
        await upload(file);
        addToast(`Uploaded ${file.name}`, 'success');
      } catch {
        addToast(`Failed to upload ${file.name}`, 'error');
      }
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".cif,.poscar,.vasp,.xyz,.pdb,.json,.txt,.in,.out,.sh,.py,.md,.png,.jpg,.jpeg,.gif,.webp,.svg"
        className="hidden"
        onChange={(e) => void handleFileSelect(e.target.files)}
      />

      <div className="flex-1 min-h-0">
        <FileBrowser
          selectedPath={selectedPath}
          onUploadRequest={() => fileInputRef.current?.click()}
          onFileSelect={(path) => {
            if (!path) return;
            onOpenPath(path);
            onNavigate?.();
          }}
        />
      </div>
    </div>
  );
}
