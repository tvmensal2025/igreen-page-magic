interface WhatsAppFloatProps {
  url: string;
  onClickTrack?: () => void;
}

const WhatsAppFloat = ({ url, onClickTrack }: WhatsAppFloatProps) => (
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-lg"
    style={{ background: "#25D366" }}
    aria-label="Falar no WhatsApp"
    onClick={onClickTrack}
  >
    <svg viewBox="0 0 32 32" className="w-6 h-6 sm:w-7 sm:h-7 fill-white">
      <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16.004c0 3.5 1.132 6.744 3.054 9.378L1.056 31.2l6.06-1.94A15.9 15.9 0 0016.004 32C24.826 32 32 24.826 32 16.004S24.826 0 16.004 0zm9.31 22.606c-.39 1.1-1.932 2.014-3.164 2.28-.844.18-1.946.324-5.66-1.216-4.752-1.97-7.81-6.79-8.046-7.106-.228-.316-1.9-2.53-1.9-4.826s1.2-3.424 1.628-3.892c.39-.426 1.028-.638 1.64-.638.198 0 .376.01.536.018.468.02.702.048 1.012.784.386.918 1.328 3.242 1.444 3.478.118.236.236.556.076.872-.15.326-.282.47-.518.74-.236.27-.46.476-.696.766-.216.254-.46.526-.196.994.264.46 1.174 1.936 2.52 3.136 1.732 1.544 3.192 2.024 3.644 2.248.352.174.77.136 1.044-.156.348-.37.778-.982 1.216-1.586.31-.432.702-.486 1.092-.326.396.15 2.508 1.182 2.938 1.398.43.216.716.326.822.502.104.176.104 1.024-.286 2.13z" />
    </svg>
  </a>
);

export default WhatsAppFloat;
