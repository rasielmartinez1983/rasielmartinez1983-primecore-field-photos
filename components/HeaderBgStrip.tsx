"use client";

// Substation photos sliding left-to-right across the header, matching the
// black header bar used on PrimeCore Ops / the PrimeCore website. Pure CSS
// animation (no JS timers): the photo list is duplicated once and the
// track is animated -50% -> 0%, which loops seamlessly forever since the
// second half of the track is identical to the first.
const HEADER_PHOTOS = [
  "1000000421.JPG",
  "1000000422.JPG",
  "1000000423.JPG",
  "1000003982.JPG",
  "1000003984.JPG",
  "1000003986.JPG",
  "1000004789.JPG",
  "1000004792.JPG",
  "1000004793.JPG",
  "1000006234.JPG",
  "1000006301.JPG",
  "1000006305.JPG",
  "1000006313.JPG",
].map((name) => encodeURI(`/Sub pictures/${name}`));

export default function HeaderBgStrip() {
  const photos = [...HEADER_PHOTOS, ...HEADER_PHOTOS];
  return (
    <div className="app-header-bg" aria-hidden="true">
      <div className="app-header-bg-track">
        {photos.map((src, i) => (
          <img key={i} src={src} alt="" />
        ))}
      </div>
    </div>
  );
}
