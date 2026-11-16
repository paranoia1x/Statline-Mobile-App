# Regenerates src/app/themes.css:  python3 scripts/gen-themes.py src/app/themes.css
import sys
def t(h): h=h.lstrip('#'); return f"{int(h[0:2],16)} {int(h[2:4],16)} {int(h[4:6],16)}"
STEPS=[950,900,850,800,750,700,600,500,400,300,200,100]
DARK_STATUS=dict(pos="#22c55e",neg="#ef4444",warn="#f59e0b",info="#8fb3ff",aiblue="#5b8def")
LIGHT_STATUS=dict(pos="#15803d",neg="#dc2626",warn="#b45309",info="#2556c9",aiblue="#2f6fed")
themes={
 "midnight":dict(ink="06040b 0d0a13 120f19 18141f 1e1926 27212f 332c3d 4a4456 6f6a7d 9d98aa c8c4d2 e9e7ef",fg="#ffffff",grid="#27212f",axis="#6b7180",text="#c5c9d2",scheme="dark"),
 "carbon":dict(ink="0a0a0b 111113 161618 1c1c1f 222226 2c2c31 3a3a40 52525a 77777f a1a1a9 cacad0 ececef",fg="#ffffff",grid="#2c2c31",axis="#71717a",text="#c9c9cf",scheme="dark"),
 "navy":dict(ink="050a14 0a1220 0e1727 131d30 18243a 213049 2c3d5a 445673 6b7c98 98a6bd c4cedd e6ebf3",fg="#ffffff",grid="#213049",axis="#6b7c98",text="#c4cedd",scheme="dark"),
 "oled":dict(ink="000000 050505 0a0a0a 111111 171717 222222 2e2e2e 484848 6e6e6e 9c9c9c c8c8c8 ececec",fg="#ffffff",grid="#222222",axis="#6e6e6e",text="#c8c8c8",scheme="dark"),
 "dim":dict(ink="1c2128 22272e 272c34 2d333b 323942 373e47 444c56 545d68 768390 909dab adbac7 cdd9e5",fg="#e6edf3",grid="#373e47",axis="#768390",text="#adbac7",scheme="dark"),
 "paper":dict(ink="f5f1e8 fffdf8 faf6ee efe9dc e9e2d2 e3dccb d2c8b2 b0a58c 766b55 5a503e 3f372a 2b2418",fg="#1a140b",grid="#e9e2d2",axis="#766b55",text="#3f372a",scheme="light"),
 "light":dict(ink="f4f3f8 ffffff f7f6fb eeedf3 e6e4ee dddae6 cbc7d6 a9a4b8 6e6984 524d68 37324b 1f1b2e",fg="#0f0c18",grid="#e6e4ee",axis="#75708a",text="#37324b",scheme="light"),
}
accents={
 "violet":"7c16e3 c4a1ff a35cff 5a0bb0 8b2cf5",
 "blue":"2f6fed a8c6ff 5b93ff 1d4fc4 3b82f6",
 "teal":"0d9488 8ce6dc 2dd4bf 0f766e 14b8a6",
 "green":"16a34a 9be8b4 34d36e 15803d 22c55e",
 "orange":"ea580c fdbb8f fb7d3c c2410c f97316",
 "rose":"e11d48 fda4b9 fb4f76 be123c f43f5e",
 "gold":"ca8a04 fde68a eab308 a16207 eab308",
}
def body(name):
    d=themes[name]; out=[]
    for s,h in zip(STEPS,d["ink"].split()): out.append(f"--ink-{s}: {t(h)};")
    st=LIGHT_STATUS if d["scheme"]=="light" else DARK_STATUS
    out.append(f"--fg-max: {t(d['fg'])};")
    for k,v in st.items(): out.append(f"--{k}: {t(v)};")
    out.append(f"--grid: {d['grid']}; --axis: {d['axis']}; --chart-text: {d['text']};")
    if d["scheme"]=="light":
        out.append("--brand-light: var(--acc-deep); --brand-bright: var(--acc-base); --ai: var(--acc-base); --hover-tint: rgb(0 0 0 / 0.04);")
    else:
        out.append("--brand-light: var(--acc-light); --brand-bright: var(--acc-bright); --ai: var(--acc-ai); --hover-tint: rgb(255 255 255 / 0.04);")
    out.append(f"color-scheme: {d['scheme']};")
    return "\n  ".join(out)
css=["/* Generated theme variables (see src/lib/appearance.ts). Colours are \"r g b\" triplets for Tailwind alpha support. */",
":root {\n  --brand: var(--acc-base); --brand-deep: var(--acc-deep);\n}"]
css.append(':root,\n:root[data-theme="midnight"],\n:root[data-theme="auto"] {\n  '+body("midnight")+"\n}")
for n in ["carbon","navy","oled","dim","light","paper"]:
    css.append(f':root[data-theme="{n}"] {{\n  '+body(n)+"\n}")
css.append('@media (prefers-color-scheme: light) {\n  :root[data-theme="auto"] {\n    '+body("light").replace("\n  ","\n    ")+"\n  }\n}")
first=True
for n,v in accents.items():
    b,l,br,dp,ai=v.split()
    sel=(':root,\n' if first else '')+f':root[data-accent="{n}"]'
    first=False
    css.append(f"{sel} {{\n  --acc-base: {t(b)}; --acc-light: {t(l)}; --acc-bright: {t(br)}; --acc-deep: {t(dp)}; --acc-ai: {t(ai)};\n}}")
css.append(':root[data-size="sm"] { font-size: 14px; }\n:root[data-size="lg"] { font-size: 17.5px; }')
open(sys.argv[1],"w").write("\n\n".join(css)+"\n")
