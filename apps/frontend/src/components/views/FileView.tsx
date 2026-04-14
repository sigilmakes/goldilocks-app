import FileViewer from '../workspace/FileViewer';

export default function FileView({ path }: { path: string }) {
  return <FileViewer path={path} showBackButton={false} />;
}
