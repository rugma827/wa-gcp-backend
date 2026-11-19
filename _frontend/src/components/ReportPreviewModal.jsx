import { createPortal } from 'react-dom';
import { X, Download, ExternalLink, FileText, Presentation, Loader } from 'lucide-react';
import './ReportPreviewModal.css';

const TYPE_META = {
  docx: { label: 'Word Document', Icon: FileText,     color: '#2b7cd3' },
  pptx: { label: 'PowerPoint',    Icon: Presentation, color: '#d24726' },
};

const _isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const ReportPreviewModal = ({ type, filename, presignedUrl, previewProxyUrl, onClose }) => {
  if (!presignedUrl) return null;

  const meta      = TYPE_META[type] || TYPE_META.docx;
  const viewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(previewProxyUrl)}`;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href     = presignedUrl;
    a.download = filename || `report.${type}`;
    a.target   = '_blank';
    a.rel      = 'noopener noreferrer';
    a.click();
  };

  const handleOpenDirect = () => {
    window.open(presignedUrl, '_blank', 'noopener,noreferrer');
  };

  return createPortal(
    <div className="rpm-overlay" onClick={onClose}>
      <div className={`rpm-shell${_isLocalDev ? ' rpm-shell--compact' : ''}`} onClick={e => e.stopPropagation()}>

        <div className="rpm-header">
          <div className="rpm-header-left">
            <span className="rpm-type-badge" style={{ background: `${meta.color}1a`, color: meta.color, borderColor: `${meta.color}40` }}>
              <meta.Icon size={13} />
              {meta.label}
            </span>
            <span className="rpm-filename">{filename || `Report.${type}`}</span>
          </div>
          <div className="rpm-header-actions">
            <button className="rpm-action-btn" onClick={handleDownload} title="Download">
              <Download size={15} />
              <span>Download</span>
            </button>
            <button className="rpm-close" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {_isLocalDev ? (
          <div className="rpm-localdev-body">
            <meta.Icon size={40} style={{ color: meta.color, opacity: 0.6 }} />
            <p className="rpm-localdev-hint">
              Office Online preview requires a publicly reachable URL.<br />
              Not available on localhost — open directly instead.
            </p>
            <button className="rpm-open-btn" onClick={handleOpenDirect}>
              <ExternalLink size={14} />
              Open in browser
            </button>
          </div>
        ) : (
          <div className="rpm-viewer">
            <div className="rpm-viewer-loader">
              <Loader size={22} className="rpm-spin" />
              <span>Loading preview…</span>
            </div>
            <iframe
              className="rpm-iframe"
              src={viewerUrl}
              title={`Preview — ${filename}`}
              frameBorder="0"
              allowFullScreen
            />
          </div>
        )}

      </div>
    </div>,
    document.body
  );
};

export default ReportPreviewModal;
