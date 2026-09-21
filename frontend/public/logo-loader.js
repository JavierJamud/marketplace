/**
 * Loader animado del logotipo (marketplace). Fondo transparente.
 * Uso: <script src="logo-loader.js"></script>  <logo-loader></logo-loader>
 * Colores: <logo-loader ink="#FFFFFF" accent="#F99417" size="120"></logo-loader>
 */
(function () {
  const CSS = `
    :host{display:inline-block;line-height:0}
    svg{display:block;background:transparent}
    .logo{transform-box:fill-box;transform-origin:center;animation:enter var(--dur) infinite both}
    .stroke{fill:none;stroke-width:34;stroke-linecap:round;stroke-linejoin:round}
    .pale{opacity:var(--pale-opacity)}
    .pale-stroke{stroke:var(--ink)}
    .pale-fill{fill:var(--accent)}
    .solid{animation:drain var(--dur) infinite both}
    .draw{stroke:var(--ink);stroke-dasharray:1 1;stroke-dashoffset:1}
    .awning{animation:drawAwning var(--dur) infinite both}
    .body{animation:drawBody var(--dur) infinite both}
    .door-clip{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0);animation:doorUp var(--dur) infinite both}
    .bar{transform-box:fill-box;transform-origin:center;transform:scale(0);animation:barPop var(--dur) infinite both}
    @keyframes enter{0%{opacity:0;transform:scale(.82)}9%{opacity:1}13%{transform:scale(1.03)}17%,92%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.86)}}
    @keyframes drawAwning{0%,16.5%{stroke-dashoffset:1}36.5%,100%{stroke-dashoffset:0}}
    @keyframes drawBody{0%,29.4%{stroke-dashoffset:1}47%,100%{stroke-dashoffset:0}}
    @keyframes doorUp{0%,47%{transform:scaleY(0)}57.6%,100%{transform:scaleY(1)}}
    @keyframes barPop{0%,53%{transform:scale(0)}59%{transform:scale(1.08)}61.6%,75%{transform:scale(1)}78%,80%{transform:scale(1,.08)}86%,100%{transform:scale(1)}}
    @keyframes drain{0%,88%{opacity:1}96%,100%{opacity:0}}
  `;

  const AWNING = "M168,48 L344,48 Q380,48 394.3,81 L439.9,186.1 A50,50 0 1 1 348,225.6 A50,50 0 0 1 256,225.6 A50,50 0 0 1 164,225.6 A50,50 0 1 1 72.1,186.1 L117.7,81 Q132,48 168,48 Z";
  const BODY = "M104,254 L104,430 A26,26 0 0 0 130,456 L382,456 A26,26 0 0 0 408,430 L408,254";
  const DOOR = "M145,346 A28,28 0 0 1 173,318 L244,318 A28,28 0 0 1 272,346 L272,442 L145,442 Z";
  const BAR = "M319,318 L347,318 A17,17 0 0 1 347,352 L319,352 A17,17 0 0 1 319,318 Z";

  const SVG = `
    <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="doorReveal"><rect class="door-clip" x="130" y="318" width="160" height="124"/></clipPath>
      </defs>
      <g class="logo">
        <g class="pale">
          <path class="stroke pale-stroke" d="${AWNING}"/>
          <path class="stroke pale-stroke" d="${BODY}"/>
          <path class="pale-fill" d="${DOOR}"/>
          <path class="pale-fill" d="${BAR}"/>
        </g>
        <g class="solid">
          <path class="stroke draw awning" pathLength="1" d="${AWNING}"/>
          <path class="stroke draw body" pathLength="1" d="${BODY}"/>
          <g clip-path="url(#doorReveal)"><path fill="var(--accent)" d="${DOOR}"/></g>
          <path class="bar" fill="var(--accent)" d="${BAR}"/>
        </g>
      </g>
    </svg>
  `;

  class LogoLoader extends HTMLElement {
    static get observedAttributes() {
      return ["ink", "accent", "pale-opacity", "size", "duration"];
    }
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      const root = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      root.appendChild(style);
      root.innerHTML += SVG;
      this._svg = root.querySelector("svg");
      this._applyVars();
    }
    attributeChangedCallback() {
      if (this._svg) this._applyVars();
    }
    _applyVars() {
      const size = this.getAttribute("size") || "160";
      this._svg.style.width = size + "px";
      this._svg.style.height = size + "px";
      this._svg.style.setProperty("--ink", this.getAttribute("ink") || "#FFFFFF");
      this._svg.style.setProperty("--accent", this.getAttribute("accent") || "#F99417");
      this._svg.style.setProperty("--pale-opacity", this.getAttribute("pale-opacity") || ".28");
      this._svg.style.setProperty("--dur", (this.getAttribute("duration") || "4.25") + "s");
    }
  }

  if (!customElements.get("logo-loader")) {
    customElements.define("logo-loader", LogoLoader);
  }
})();
