// Adds a "Color" row to the Add/Edit Feature, Part and Primer dialogs.
// scripts/patch-ove.js makes the shared annotation dialog call
// window.oveFeatureColorField(React, { change, initialValues, readOnly, annotationTypePlural }).
//
// The value is written into the redux-form field "color", so it is saved on the
// annotation itself. OVE renders annotation.color in preference to the colour of
// the feature's type, and jsonToGenbank writes it out as a /color= qualifier, so
// per-feature colours survive saving to .gb and reopening.
(function () {
  // A colour-blind-friendly spread, dark enough for white label text.
  const PRESETS = [
    "#EF6500", "#D62728", "#B5179E", "#7B2CBF", "#3F37C9", "#006FEF",
    "#0098B7", "#118C4F", "#31B440", "#8AB17D", "#B38B00", "#8C564B",
    "#5A6978", "#2F3640",
  ];
  const HEX = /^#[0-9a-f]{6}$/i;

  const typeColor = (type) => {
    try {
      return (window.sequenceUtils.getFeatureToColorMap({ includeHidden: true }) || {})[type];
    } catch (e) {
      return undefined;
    }
  };

  function makeComponent(React) {
    class ColorField extends React.Component {
      constructor(props) {
        super(props);
        const iv = props.initialValues || {};
        // OVE fills in the type's colour on load, so treat "same as the type"
        // as not explicitly set — that is what the user sees it as.
        const fromType = typeColor(iv.type);
        const explicit =
          HEX.test(iv.color || "") &&
          (!fromType || iv.color.toUpperCase() !== String(fromType).toUpperCase());
        this.state = { color: explicit ? iv.color.toUpperCase() : "" };
      }
      set(color) {
        // "" means: follow the feature type's colour (no /color= qualifier written)
        this.setState({ color });
        this.props.change("color", color || undefined);
      }
      render() {
        const h = React.createElement;
        const { readOnly, initialValues = {} } = this.props;
        const fallback = typeColor(initialValues.type) || "#BBBBBB";
        const effective = this.state.color || fallback;
        const swatch = (color, title, onClick, selected) =>
          h("button", {
            type: "button",
            key: color + title,
            title,
            disabled: readOnly,
            onClick,
            className: "ove-color-swatch" + (selected ? " ove-color-swatch-on" : ""),
            style: { background: color },
          });
        return h(
          "div",
          { className: "ove-color-field" },
          h("label", { className: "bp3-label ove-color-label" }, "Color"),
          h(
            "div",
            { className: "ove-color-controls" },
            h(
              "div",
              { className: "ove-color-swatches" },
              PRESETS.map((c) => swatch(c, c, () => this.set(c), this.state.color.toUpperCase() === c)),
              h("input", {
                type: "color",
                title: "Custom colour",
                disabled: readOnly,
                value: effective,
                className: "ove-color-custom",
                onChange: (e) => this.set(e.target.value.toUpperCase()),
              })
            ),
            h(
              "div",
              { className: "ove-color-note" },
              this.state.color
                ? h(
                    "span",
                    null,
                    h("span", { className: "ove-color-dot", style: { background: effective } }),
                    `${effective} · `,
                    h(
                      "a",
                      { onClick: readOnly ? null : () => this.set(""), className: "ove-color-reset" },
                      "use the type's colour"
                    )
                  )
                : h(
                    "span",
                    null,
                    h("span", { className: "ove-color-dot", style: { background: fallback } }),
                    `following the ${initialValues.type || "feature"} type colour`
                  )
            )
          )
        );
      }
    }
    return ColorField;
  }

  let Comp = null;
  window.oveFeatureColorField = function (React, props) {
    try {
      if (!React || !props || typeof props.change !== "function") return null;
      if (!Comp) Comp = makeComponent(React);
      return React.createElement(Comp, { key: "ove-color", ...props });
    } catch (e) {
      console.error("colour field failed to render", e);
      return null;
    }
  };
})();
