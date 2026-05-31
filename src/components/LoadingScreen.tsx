import BrandLogo from "@/components/common/BrandLogo";

const LoadingScreen = () => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background">
    <BrandLogo className="w-40 animate-pulse" />
    <div className="flex gap-1">
      <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-3 h-3 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  </div>
);

export default LoadingScreen;
