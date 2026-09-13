# Country outlines

Drop SVG files here. The build inlines them into the deck, so the presentation
keeps working from a memory stick with no network — which is the whole reason
they live in the repo rather than in R2 or on Cloudflare.

Expected names:

    us.svg       United States outline
    hr.svg       Croatia outline
    world.svg    whole world, ONLY if it is equirectangular (see below)

WHAT MAKES A USABLE FILE

  * Outlines, not fills. A path with `fill="none"` or a plain shape is ideal;
    a file full of styled sub-paths per state or county will be simplified.
  * A viewBox. Without one the shape cannot be scaled into the disc.
  * For `world.svg`, the projection matters. An EQUIRECTANGULAR map (the plain
    rectangular one, 2:1, where latitude and longitude are straight lines) can
    be converted to the globe's orthographic projection, because its
    coordinates map linearly onto latitude and longitude. A Mercator or any
    stylised projection cannot be converted back reliably and would come out
    visibly distorted.

Nothing here is loaded at runtime. `presentation/build.mjs` reads these files
at build time and writes their path data into the single output file.
