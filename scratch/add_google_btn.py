import os

def update_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add import
    content = content.replace('import Link from "next/link";', 'import Link from "next/link";\nimport { signIn } from "next-auth/react";')

    # Add Google button
    google_btn = '''
              <div style={{ marginTop: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center' }}>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
                <div style={{ padding: '0 10px', fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>OR</div>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'rgba(255,255,255,0.1)' }}></div>
              </div>
              <button type="button" onClick={() => signIn('google', { callbackUrl: '/' })} className="button w-inline-block" style={{ width: '100%', display: 'flex', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="button-wrap-out" style={{ width: '100%' }}>
                  <div className="button-wrap-in">
                    <div className="body-m" style={{ color: '#fff' }}>Continue with Google</div>
                    <div className="body-m position-absolute" style={{ color: '#fff' }}>Continue with Google</div>
                  </div>
                </div>
              </button>
'''
    content = content.replace('</form>', f'</form>{google_btn}')

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

update_file(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\login\page.tsx')
update_file(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\signup\page.tsx')
print('Buttons added!')
