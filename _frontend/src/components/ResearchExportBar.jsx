import { useState } from 'react';
import { FileText, Presentation, Loader, AlertCircle } from 'lucide-react';
import { MARKET_RESEARCH_API_URL } from '../config/api';
import ReportPreviewModal from './ReportPreviewModal';
import './ResearchExportBar.css';

const TYPE_META = {
  docx: { label: 'DOCX', Icon: FileText },
  pptx: { label: 'PPTX', Icon: Presentation },
};

const ExportButton = ({ type, reportId, filename, onPreview }) => {
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const { label, Icon } = TYPE_META[type];

  const handleClick = async () => {
    if (state === 'loading') return;
    setState('loading');

    try {
      const res = await fetch(`${MARKET_RESEARCH_API_URL}/research/${reportId}/${type}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { download_url } = await res.json();
      setState('idle');
      const _publicBackend = import.meta.env.VITE_BACKEND_URL || 'https://wealth-advisory.44-217-187-6.sslip.io:8000';
      const previewProxyUrl = `${_publicBackend}/research/preview/${reportId}/${type}`;
      onPreview({ type, filename, presignedUrl: download_url, previewProxyUrl });
    } catch (err) {
      console.error(`[EXPORT] ${type} preview failed:`, err);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  return (
    <button
      className={`reb-btn reb-btn--${state}`}
      onClick={handleClick}
      disabled={state === 'loading'}
      title={`Preview ${label}`}
    >
      {state === 'loading' ? (
        <Loader size={13} className="reb-spin" />
      ) : state === 'error' ? (
        <AlertCircle size={13} />
      ) : (
        <Icon size={13} />
      )}
      <span>{state === 'error' ? 'Failed' : label}</span>

    </button>
  );
};

const ResearchExportBar = ({ reportId, files }) => {
  const [preview, setPreview] = useState(null); // { type, filename, presignedUrl }

  const hasDocx = !!files?.docx_path;
  const hasPptx = !!files?.pptx_path;

  if (!hasDocx && !hasPptx) return null;

  return (
    <>
      <div className="reb-root">
        <span className="reb-label">Export</span>
        <div className="reb-actions">
          {hasDocx && (
            <ExportButton
              type="docx"
              reportId={reportId}
              filename={files.docx_path?.split('/').pop()}
              onPreview={setPreview}
            />
          )}
          {hasPptx && (
            <ExportButton
              type="pptx"
              reportId={reportId}
              filename={files.pptx_path?.split('/').pop()}
              onPreview={setPreview}
            />
          )}
        </div>
      </div>

      {preview && (
        <ReportPreviewModal
          type={preview.type}
          filename={preview.filename}
          presignedUrl={preview.presignedUrl}
          previewProxyUrl={preview.previewProxyUrl}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
};

export default ResearchExportBar;
