interface GpuNoticeProps {
  message: string;
  /** Omitted when the resolution is already the default, where resetting it
   * would change nothing and the offer would misdirect the reader. */
  onResetResolution?: () => void;
}

export const GpuNotice = ({ message, onResetResolution }: GpuNoticeProps) => (
  <p className="notice" role="alert">
    {message}
    {onResetResolution !== undefined && (
      <button
        type="button"
        className="notice__action"
        onClick={onResetResolution}
      >
        Reset resolution and reload
      </button>
    )}
  </p>
);
