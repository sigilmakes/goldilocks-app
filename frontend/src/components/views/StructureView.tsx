import FileViewer from '../workspace/FileViewer';

export default function StructureView({ path }: { path: string }) {
  return <FileViewer path={path} showBackButton={false} />;
}
