// Custom Decap CMS widget: "framed-photo" — GAME-SPEC-style build note kept
// here since there's no other home for it. Lets the founder drag a photo to
// reposition it and use a slider to zoom, for any field that renders into a
// fixed-aspect-ratio CSS frame on the live site (currently just the home
// page's site.images.home_who — see src/index.njk's .frame).
//
// Stores { src, focal_x, focal_y, zoom } instead of a plain image path.
// focal_x/focal_y are 0-100 (percent, matching CSS object-position exactly);
// zoom is 100-250 (percent, matching CSS transform:scale*100).
//
// The editor's crop box uses the SAME technique as the real site
// (object-fit:cover + object-position + transform-origin/scale on an actual
// <img>, inside an overflow:hidden box at the frame's real aspect ratio) so
// dragging here is a true WYSIWYG preview, not an approximation — this is
// standing in for Decap's entry-preview pane, which is disabled site-wide
// (config.yml: editor.preview: false) for a cleaner editor.
//
// No build step: uses the createClass/h globals decap-cms.js exposes for
// exactly this no-JSX scenario. Loaded after decap-cms.js in admin/index.html.
(function () {
  var FRAME_RATIO = 21 / 9; // must match .frame's aspect-ratio in main.css

  function getVal(value, key, fallback) {
    if (value == null) return fallback;
    if (typeof value.get === "function") {
      var v = value.get(key);
      return v === undefined || v === null ? fallback : v;
    }
    return value[key] === undefined || value[key] === null ? fallback : value[key];
  }

  function plainValue(value) {
    return {
      src: getVal(value, "src", ""),
      focal_x: Number(getVal(value, "focal_x", 50)),
      focal_y: Number(getVal(value, "focal_y", 50)),
      zoom: Number(getVal(value, "zoom", 100)),
    };
  }

  var FramedPhotoControl = createClass({
    getInitialState: function () {
      return { dragging: false };
    },

    handleOpenMediaLibrary: function () {
      var props = this.props;
      props.onOpenMediaLibrary({
        controlID: props.forID,
        forImage: true,
        value: getVal(props.value, "src", ""),
        allowMultiple: false,
        field: props.field,
      });
    },

    componentDidUpdate: function (prevProps) {
      if (this.props.mediaPaths !== prevProps.mediaPaths) {
        var mediaPath = this.props.mediaPaths.get(this.props.forID);
        if (mediaPath) {
          var v = plainValue(this.props.value);
          v.src = mediaPath;
          this.props.onChange(v);
          this.props.onClearMediaControl(this.props.forID);
        }
      }
    },

    handleRemove: function () {
      this.props.onChange({ src: "", focal_x: 50, focal_y: 50, zoom: 100 });
    },

    handleZoom: function (e) {
      var v = plainValue(this.props.value);
      v.zoom = Number(e.target.value);
      this.props.onChange(v);
    },

    // Drag-to-reposition: dragging the photo right reveals more of its LEFT
    // side (like sliding a physical print under a window), so focal_x moves
    // opposite the mouse delta — matches direct-manipulation photo-crop UX
    // (Instagram/Facebook cover-photo repositioning, Google Photos crop).
    handleMouseDown: function (e) {
      e.preventDefault();
      var box = this._box;
      if (!box) return;
      var rect = box.getBoundingClientRect();
      var startX = e.clientX, startY = e.clientY;
      var startVal = plainValue(this.props.value);
      var onChange = this.props.onChange;
      var self = this;

      function clamp(n) { return Math.max(0, Math.min(100, n)); }

      function onMove(ev) {
        var dxPct = ((ev.clientX - startX) / rect.width) * 100;
        var dyPct = ((ev.clientY - startY) / rect.height) * 100;
        onChange({
          src: startVal.src,
          focal_x: clamp(startVal.focal_x - dxPct),
          focal_y: clamp(startVal.focal_y - dyPct),
          zoom: startVal.zoom,
        });
      }
      function onUp() {
        self.setState({ dragging: false });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      this.setState({ dragging: true });
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },

    render: function () {
      var v = plainValue(this.props.value);
      var self = this;

      if (!v.src) {
        return h(
          "div",
          {},
          h(
            "button",
            {
              type: "button",
              className: "framed-photo-choose-btn",
              onClick: this.handleOpenMediaLibrary,
            },
            "Choose image"
          )
        );
      }

      return h(
        "div",
        { className: "framed-photo-widget" },
        h(
          "div",
          {
            className: "framed-photo-box" + (this.state.dragging ? " dragging" : ""),
            style: { aspectRatio: String(FRAME_RATIO) },
            ref: function (el) { self._box = el; },
            onMouseDown: this.handleMouseDown,
          },
          h("img", {
            src: v.src,
            draggable: false,
            style: {
              objectPosition: v.focal_x + "% " + v.focal_y + "%",
              transformOrigin: v.focal_x + "% " + v.focal_y + "%",
              transform: "scale(" + v.zoom / 100 + ")",
            },
          })
        ),
        h(
          "div",
          { className: "framed-photo-controls" },
          h("span", { className: "framed-photo-hint" }, "Drag the photo above to reposition it"),
          h(
            "label",
            { className: "framed-photo-zoom" },
            "Zoom",
            h("input", {
              type: "range",
              min: 100,
              max: 250,
              value: v.zoom,
              onChange: this.handleZoom,
            }),
            h("span", {}, Math.round(v.zoom) + "%")
          ),
          h(
            "button",
            { type: "button", className: "framed-photo-replace-btn", onClick: this.handleOpenMediaLibrary },
            "Replace"
          ),
          h(
            "button",
            { type: "button", className: "framed-photo-remove-btn", onClick: this.handleRemove },
            "Remove"
          )
        )
      );
    },
  });

  var FramedPhotoPreview = createClass({
    render: function () {
      var v = plainValue(this.props.value);
      if (!v.src) return null;
      return h("img", { src: v.src, style: { maxWidth: "200px" } });
    },
  });

  CMS.registerWidget("framed-photo", FramedPhotoControl, FramedPhotoPreview);

  var style = document.createElement("style");
  style.textContent =
    ".framed-photo-box{position:relative;overflow:hidden;width:100%;max-width:640px;" +
    "border:1px solid rgba(47,216,255,.35);cursor:grab;background:#0B0F15;border-radius:2px}" +
    ".framed-photo-box.dragging{cursor:grabbing}" +
    ".framed-photo-box img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" +
    "user-select:none;pointer-events:none}" +
    ".framed-photo-controls{display:flex;align-items:center;gap:16px;margin-top:10px;flex-wrap:wrap}" +
    ".framed-photo-hint{font-size:12px;color:#788;}" +
    ".framed-photo-zoom{display:flex;align-items:center;gap:8px;font-size:13px}" +
    ".framed-photo-choose-btn,.framed-photo-replace-btn,.framed-photo-remove-btn{" +
    "border:1px solid rgba(47,216,255,.5);background:#fff;border-radius:2px;padding:6px 14px;" +
    "font-size:13px;cursor:pointer}" +
    ".framed-photo-remove-btn{border-color:rgba(255,45,106,.5);color:#a33}";
  document.head.appendChild(style);
})();
