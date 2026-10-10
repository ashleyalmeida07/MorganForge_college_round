import re

with open(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\securiotemplate\index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Extract body content
body_match = re.search(r'<body[^>]*>(.*)</body>', html, re.DOTALL)
if body_match:
    body = body_match.group(1)
else:
    body = html

# Replace class with className
body = body.replace('class=', 'className=')
body = body.replace('for=', 'htmlFor=')
body = body.replace('autocomplete=', 'autoComplete=')
body = body.replace('maxlength=', 'maxLength=')
body = body.replace('tabindex=', 'tabIndex=')
body = body.replace('readonly=', 'readOnly=')

# Remove scripts from body
body = re.sub(r'<script.*?</script>', '', body, flags=re.DOTALL)

# Fix self-closing tags
def close_tag(match):
    tag = match.group(1)
    attrs = match.group(2)
    if not attrs.endswith('/'):
        return f'<{tag}{attrs} />'
    return match.group(0)

body = re.sub(r'<(img|br|hr|input|meta|link)([^>]*?)>', close_tag, body)

# Fix inline styles with dangerouslySetInnerHTML
body = re.sub(r'<style>(.*?)</style>', r'<style dangerouslySetInnerHTML={{__html: `\1`}} />', body, flags=re.DOTALL)

page_tsx = f'''"use client";
import React, {{ useEffect }} from "react";

export default function Page() {{
  useEffect(() => {{
    const scripts = [
      "/js/jquery.js?site=69d7f44961b88686fd48eee3",
      "/js/webflow.schunk.38092a41f577771c.js",
      "/js/webflow-script.js",
      "/js/gsap.min.js",
      "/js/scrolltrigger.min.js",
      "https://unpkg.com/split-type",
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js",
      "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"
    ];
    
    scripts.forEach(src => {{
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      document.body.appendChild(script);
    }});

    setTimeout(() => {{
      if (window.gsap && window.SplitType && window.ScrollTrigger) {{
        window.gsap.registerPlugin(window.ScrollTrigger);
        const splitTypes = document.querySelectorAll(".scroll-highlight");
        splitTypes.forEach((char) => {{
          const text = new window.SplitType(char, {{ types: ["chars", "words"] }});
          window.gsap.from(text.chars, {{
            scrollTrigger: {{
              trigger: char,
              start: "top 80%",
              end: "top 20%",
              scrub: true,
              markers: false
            }},
            opacity: 0.2,
            stagger: 0.1
          }});
        }});
      }}
    }}, 1000);
  }}, []);

  return (
    <>
      {body}
    </>
  );
}}
'''

with open(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\page.tsx', 'w', encoding='utf-8') as f:
    f.write(page_tsx)
print('Done!')
