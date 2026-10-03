/**
 * An XSS corpus for the sanitizer, independent of its allow-lists: what an
 * attacker sends, grouped by the trick it relies on. Every vector is run
 * under every policy by `sanitizer-corpus.test.ts` against one oracle (no
 * script-capable construct survives) and against DOMPurify (nothing we keep
 * is something it drops). A finding adds a vector to `REGRESSIONS` with the
 * date and the fix; the corpus never shrinks.
 *
 * The vectors are written from the well-known classes — handlers, URL
 * schemes and their encodings, raw-text and foreign-content mutation (mXSS),
 * DOM clobbering, form and navigation elements, srcset and media — not
 * copied from any one list.
 */

export interface Vector {
  readonly id: string;
  readonly input: string;
  /** What the vector relies on; the oracle and the notes read it. */
  readonly note?: string;
}

export interface VectorClass {
  readonly name: string;
  readonly vectors: readonly Vector[];
}

const C0 = String.fromCharCode(1);
const NUL = String.fromCharCode(0);
const LS = String.fromCharCode(0x2028);

export const CORPUS: readonly VectorClass[] = [
  {
    name: 'event handlers',
    vectors: [
      { id: 'img-onerror', input: '<img src="x" onerror="alert(1)">' },
      { id: 'img-onerror-upper', input: '<IMG SRC="x" ONERROR="alert(1)">' },
      { id: 'img-onerror-newline', input: '<img src="x"\nonerror\n=\n"alert(1)">' },
      { id: 'body-onload', input: '<body onload="alert(1)"><p>x</p></body>' },
      { id: 'svg-onload', input: '<svg onload="alert(1)"></svg>' },
      {
        id: 'details-ontoggle',
        input: '<details open ontoggle="alert(1)"><summary>x</summary></details>',
      },
      { id: 'marquee-onstart', input: '<marquee onstart="alert(1)">x</marquee>' },
      { id: 'input-autofocus', input: '<input onfocus="alert(1)" autofocus>' },
      {
        id: 'select-autofocus',
        input: '<select onfocus="alert(1)" autofocus><option>x</option></select>',
      },
      { id: 'video-onerror', input: '<video><source onerror="alert(1)"></video>' },
      { id: 'a-onmouseover', input: '<a href="#" onmouseover="alert(1)">x</a>' },
      { id: 'p-onclick-quoteless', input: '<p onclick=alert(1)>x</p>' },
      { id: 'on-attribute-with-space', input: '<p on click="alert(1)">x</p>' },
      {
        id: 'handler-in-allowed-nested',
        input: '<p><strong><em onmouseenter="alert(1)">x</em></strong></p>',
      },
      {
        id: 'contenteditable-onfocus',
        input: '<p contenteditable onfocus="alert(1)" tabindex="0">x</p>',
      },
    ],
  },
  {
    name: 'url schemes and encodings',
    vectors: [
      { id: 'a-javascript', input: '<a href="javascript:alert(1)">x</a>' },
      { id: 'a-javascript-mixed-case', input: '<a href="jAvAsCrIpT:alert(1)">x</a>' },
      { id: 'a-javascript-leading-space', input: '<a href="  javascript:alert(1)">x</a>' },
      { id: 'a-javascript-tab-inside', input: '<a href="jav&#x09;ascript:alert(1)">x</a>' },
      { id: 'a-javascript-newline-inside', input: '<a href="jav&#x0A;ascript:alert(1)">x</a>' },
      { id: 'a-javascript-cr-inside', input: '<a href="jav&#x0D;ascript:alert(1)">x</a>' },
      {
        id: 'a-javascript-decimal-entity',
        input: '<a href="&#106;&#97;&#118;&#97;script:alert(1)">x</a>',
      },
      { id: 'a-javascript-hex-entity', input: '<a href="&#x6A;avascript:alert(1)">x</a>' },
      { id: 'a-javascript-named-colon', input: '<a href="javascript&colon;alert(1)">x</a>' },
      {
        id: 'a-javascript-c0-prefix',
        input: `<a href="${C0}javascript:alert(1)">x</a>`,
        note: 'the URL parser strips leading C0 controls',
      },
      { id: 'a-javascript-nul-inside', input: `<a href="java${NUL}script:alert(1)">x</a>` },
      { id: 'a-javascript-ls-prefix', input: `<a href="${LS}javascript:alert(1)">x</a>` },
      { id: 'a-javascript-space-before-colon', input: '<a href="javascript :alert(1)">x</a>' },
      { id: 'a-vbscript', input: '<a href="vbscript:msgbox(1)">x</a>' },
      { id: 'a-livescript', input: '<a href="livescript:alert(1)">x</a>' },
      {
        id: 'a-data-html',
        input: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
      },
      { id: 'a-data-text', input: '<a href="data:text/plain,hello">x</a>' },
      { id: 'img-data', input: '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">' },
      { id: 'a-blob', input: '<a href="blob:https://example.com/uuid">x</a>' },
      { id: 'a-file', input: '<a href="file:///etc/passwd">x</a>' },
      { id: 'a-about', input: '<a href="about:blank">x</a>' },
      { id: 'a-unknown-scheme', input: '<a href="foo:bar">x</a>' },
      { id: 'a-backslash-protocol-relative', input: '<a href="/\\evil.example/">x</a>' },
      {
        id: 'a-percent-encoded-scheme',
        input: '<a href="%6Aavascript:alert(1)">x</a>',
        note: 'not decoded by the parser; a relative path',
      },
      { id: 'img-src-javascript', input: '<img src="javascript:alert(1)">' },
      { id: 'video-poster-javascript', input: '<video poster="javascript:alert(1)"></video>' },
      {
        id: 'blockquote-cite-javascript',
        input: '<blockquote cite="javascript:alert(1)">x</blockquote>',
      },
      { id: 'q-cite-data', input: '<q cite="data:text/html,x">x</q>' },
    ],
  },
  {
    name: 'srcset and media',
    vectors: [
      { id: 'img-srcset-javascript', input: '<img srcset="javascript:alert(1) 1x">' },
      { id: 'img-srcset-mixed', input: '<img srcset="/a.png 1x, javascript:alert(1) 2x">' },
      { id: 'img-srcset-data', input: '<img srcset="data:image/png;base64,AAAA 1x">' },
      {
        id: 'source-srcset-javascript',
        input: '<picture><source srcset="javascript:alert(1)"><img src="/a.png"></picture>',
      },
      { id: 'img-lowsrc', input: '<img src="/a.png" lowsrc="javascript:alert(1)">' },
      { id: 'img-dynsrc', input: '<img dynsrc="javascript:alert(1)">' },
      { id: 'video-src-javascript', input: '<video src="javascript:alert(1)" controls></video>' },
      { id: 'audio-source-javascript', input: '<audio><source src="javascript:alert(1)"></audio>' },
      { id: 'img-longdesc', input: '<img src="/a.png" longdesc="javascript:alert(1)">' },
    ],
  },
  {
    name: 'script, style and active elements',
    vectors: [
      { id: 'script', input: '<script>alert(1)</script>' },
      { id: 'script-mixed-case', input: '<ScRiPt>alert(1)</sCrIpT>' },
      { id: 'script-in-p', input: '<p>a<script>alert(1)</script>b</p>' },
      { id: 'script-src', input: '<script src="https://evil.example/x.js"></script>' },
      { id: 'style-import', input: '<style>@import "https://evil.example/x.css";</style>' },
      { id: 'style-expression', input: '<p style="width: expression(alert(1))">x</p>' },
      { id: 'style-url', input: '<p style="background: url(javascript:alert(1))">x</p>' },
      { id: 'iframe-src', input: '<iframe src="javascript:alert(1)"></iframe>' },
      { id: 'iframe-srcdoc', input: '<iframe srcdoc="<script>alert(1)</script>"></iframe>' },
      { id: 'object-data', input: '<object data="javascript:alert(1)"></object>' },
      { id: 'embed-src', input: '<embed src="javascript:alert(1)">' },
      { id: 'link-import', input: '<link rel="import" href="https://evil.example/x.html">' },
      { id: 'link-stylesheet', input: '<link rel="stylesheet" href="https://evil.example/x.css">' },
      {
        id: 'meta-refresh',
        input: '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
      },
      { id: 'base-href', input: '<base href="https://evil.example/">' },
      { id: 'template-script', input: '<template><script>alert(1)</script></template>' },
      {
        id: 'noscript-p-title',
        input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
      },
      { id: 'frameset', input: '<frameset><frame src="javascript:alert(1)"></frameset>' },
      { id: 'applet', input: '<applet code="x.class"></applet>' },
      { id: 'keygen', input: '<keygen autofocus onfocus="alert(1)">' },
      { id: 'isindex', input: '<isindex action="javascript:alert(1)" type="image">' },
    ],
  },
  {
    name: 'forms and navigation',
    vectors: [
      {
        id: 'form-action',
        input: '<form action="javascript:alert(1)"><input type="submit"></form>',
      },
      { id: 'button-formaction', input: '<button formaction="javascript:alert(1)">x</button>' },
      { id: 'input-image-src', input: '<input type="image" src="javascript:alert(1)">' },
      {
        id: 'input-submit-formaction',
        input: '<input type="submit" formaction="javascript:alert(1)">',
      },
      { id: 'a-ping', input: '<a href="/x" ping="https://evil.example/">x</a>' },
      {
        id: 'a-target-top-opener',
        input: '<a href="https://other.example/" target="_top" rel="opener">x</a>',
      },
      {
        id: 'table-background',
        input: '<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
      },
      {
        id: 'td-background',
        input: '<table><tr><td background="javascript:alert(1)">x</td></tr></table>',
      },
      { id: 'body-background', input: '<body background="javascript:alert(1)"><p>x</p></body>' },
      { id: 'math-href', input: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>' },
      {
        id: 'svg-a-xlink',
        input: '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
      },
      {
        id: 'svg-animate-href',
        input:
          '<svg><a><animate attributeName="href" to="javascript:alert(1)"></animate><text>x</text></a></svg>',
      },
      {
        id: 'svg-set-onmouseover',
        input: '<svg><set attributeName="onmouseover" to="alert(1)"></set></svg>',
      },
      {
        id: 'svg-use-data',
        input: '<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="></use></svg>',
      },
      {
        id: 'svg-foreignobject-script',
        input: '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>',
      },
    ],
  },
  {
    name: 'mutation (mXSS) and parser context',
    vectors: [
      {
        id: 'mxss-svg-style-breakout',
        input: '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>"></a></style></svg>',
      },
      {
        id: 'mxss-math-mtext-table',
        input:
          '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
      },
      {
        id: 'mxss-form-math',
        input:
          '<form><math><mtext></form><form><mglyph><style></math><img src=x onerror=alert(1)></style></mglyph></form></form>',
      },
      { id: 'mxss-noembed', input: '<noembed><img src=x onerror=alert(1)></noembed>' },
      { id: 'mxss-xmp', input: '<xmp><img src=x onerror=alert(1)></xmp>' },
      { id: 'mxss-title', input: '<title><img src=x onerror=alert(1)></title>' },
      { id: 'mxss-textarea', input: '<textarea><img src=x onerror=alert(1)></textarea>' },
      { id: 'mxss-plaintext', input: '<plaintext><img src=x onerror=alert(1)>' },
      { id: 'mxss-listing', input: '<listing><img src=x onerror=alert(1)></listing>' },
      { id: 'mxss-comment-breakout', input: '<!-- <img src=x onerror=alert(1)> -->' },
      { id: 'mxss-comment-bang', input: '<!--><img src=x onerror=alert(1)>' },
      { id: 'mxss-cdata', input: '<![CDATA[<img src=x onerror=alert(1)>]]>' },
      { id: 'mxss-p-in-a-in-p', input: '<p><a href="/x"><p><img src=x onerror=alert(1)></a></p>' },
      {
        id: 'mxss-attribute-quote-breakout',
        input: '<p title="x" title="&quot;><img src=x onerror=alert(1)>">x</p>',
      },
      { id: 'mxss-attribute-gt-in-value', input: '<p title="><img src=x onerror=alert(1)>">x</p>' },
      { id: 'mxss-entity-in-text', input: '<p>&lt;img src=x onerror=alert(1)&gt;</p>' },
      { id: 'mxss-unclosed-tag', input: '<p><img src=x onerror=alert(1)' },
      {
        id: 'mxss-nested-unwrap',
        input: '<div><section><script>alert(1)</script><span>x</span></section></div>',
      },
      {
        id: 'mxss-select-option-script',
        input: '<select><option><script>alert(1)</script></option></select>',
      },
      {
        id: 'mxss-table-script',
        input: '<table><script>alert(1)</script><tr><td>x</td></tr></table>',
      },
      { id: 'mxss-svg-in-a', input: '<a href="/x"><svg><script>alert(1)</script></svg>x</a>' },
      {
        id: 'mxss-annotation-xml',
        input:
          '<math><annotation-xml encoding="text/html"><script>alert(1)</script></annotation-xml></math>',
      },
      {
        id: 'mxss-desc-in-svg',
        input: '<svg><desc><![CDATA[</desc><script>alert(1)</script>]]></desc></svg>',
      },
    ],
  },
  {
    name: 'dom clobbering',
    vectors: [
      { id: 'clobber-img-name', input: '<img name="location" src="/x.png">' },
      { id: 'clobber-form-id', input: '<form id="document"><input name="cookie"></form>' },
      { id: 'clobber-a-id-defaultview', input: '<a id="defaultView" href="/x">x</a>' },
      { id: 'clobber-input-name-attributes', input: '<input name="attributes">' },
      { id: 'clobber-img-id-body', input: '<img id="body" src="/x.png">' },
      {
        id: 'clobber-nested-forms',
        input: '<form id="x"><form id="x"><input name="y"></form></form>',
      },
      { id: 'clobber-a-name-getelementbyid', input: '<a name="getElementById" href="/x">x</a>' },
      { id: 'clobber-object-name', input: '<object name="currentScript"></object>' },
      { id: 'clobber-embed-name', input: '<embed name="createElement">' },
      {
        id: 'clobber-p-id-payload',
        input: '<p id="__payload" data-payload-field="title">x</p>',
        note: 'binding injection, strict strips both',
      },
    ],
  },
  {
    name: 'attributes that steer behaviour',
    vectors: [
      { id: 'a-download-javascript', input: '<a href="/x" download="x.html">x</a>' },
      {
        id: 'img-usemap',
        input:
          '<img src="/x.png" usemap="#m"><map name="m"><area href="javascript:alert(1)"></map>',
      },
      { id: 'p-is-custom', input: '<p is="x-evil">x</p>' },
      { id: 'p-slot', input: '<p slot="x">x</p>' },
      { id: 'p-xmlns', input: '<p xmlns="http://www.w3.org/2000/svg">x</p>' },
      { id: 'p-xlink-href', input: '<p xlink:href="javascript:alert(1)">x</p>' },
      { id: 'p-itemtype', input: '<p itemscope itemtype="https://evil.example/">x</p>' },
      { id: 'p-accesskey', input: '<p accesskey="x" tabindex="0">x</p>' },
      {
        id: 'a-referrerpolicy',
        input: '<a href="https://other.example/" referrerpolicy="unsafe-url">x</a>',
      },
      { id: 'img-crossorigin', input: '<img src="/x.png" crossorigin="use-credentials">' },
      { id: 'video-autoplay', input: '<video src="/x.mp4" autoplay muted loop></video>' },
    ],
  },
];

/**
 * Findings, one vector each with the date and the change that answered it.
 * Empty until the corpus finds something; the test fails on any entry whose
 * `id` also appears above, so a finding is recorded once.
 */
export const REGRESSIONS: readonly Vector[] = [];
