"use client";
import { useEffect, useRef, useState } from "react";

const VIDEO = "/media/landmarks.mp4";
const POSTER = "/media/landmarks-poster.jpg";

/**
 * Full-viewport cinematic landmark montage (licensed footage, see
 * public/media/CREDITS.md). Always muted and decorative. Shows only the
 * poster for reduced motion, Data Saver / very slow connections, or when
 * the browser blocks autoplay. Pauses while the tab is hidden.
 */
export function CinematicBackground({
  reducedMotion,
}: {
  reducedMotion: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [lowData, setLowData] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const nav: Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    } = navigator;
    const c = nav.connection;
    setLowData(
      Boolean(c?.saveData) ||
        ["slow-2g", "2g"].includes(c?.effectiveType ?? ""),
    );
  }, []);

  const motion = !reducedMotion && !lowData;
  useEffect(() => {
    const v = video.current;
    if (!v || !motion) return;
    const play = () => {
      if (document.hidden) return;
      // Autoplay can be refused (power saving, policies): keep the poster.
      void v.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    };
    const onVisibility = () => {
      if (document.hidden) v.pause();
      else play();
    };
    play();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      v.pause();
    };
  }, [motion]);

  return (
    <div
      className="cinematic-bg"
      aria-hidden="true"
      data-motion={motion ? "video" : "static"}
      data-playing={playing ? "true" : "false"}
    >
      {motion ? (
        <video
          ref={video}
          className="cinematic-media"
          src={VIDEO}
          poster={POSTER}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
        />
      ) : (
        // biome-ignore lint/performance/noImgElement: a static decorative poster; next/image adds nothing for a fixed local background.
        <img className="cinematic-media" src={POSTER} alt="" />
      )}
      <div className="cinematic-overlay" />
    </div>
  );
}
