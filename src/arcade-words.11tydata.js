// The arcade's words file (/arcade/words.json): written only while the arcade
// is switched on — see arcade.11tydata.js for why the gate lives here.
module.exports = {
  eleventyComputed: {
    permalink: (data) => (data.visible.sections.arcade ? "/arcade/words.json" : false),
    arcadeWords: (data) => {
      const out = {};
      for (const l of data.site.languages) if (data.i18n[l] && data.i18n[l].arcade) out[l] = data.i18n[l].arcade;
      return out;
    },
  },
};
