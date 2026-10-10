import re

with open(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Replacements
content = content.replace('Cybersecurity services for a new era of risk', 'Verifiable computation for a new era of trust')
content = content.replace('Protect your business from cyber threats.', 'Prove the computation, not just the result.')
content = content.replace('>Securio<', '>Verity<')
content = content.replace('Securio Logo', 'Verity Logo')
content = content.replace('Securio solution suite', 'Verity solution suite')
content = content.replace('WHY SECURIO', 'WHY VERITY')
content = content.replace('securio solution suite', 'verity solution suite')

# Remove Webflow text
content = re.sub(r'<div className="body-s text-color-secondary-light">Powered by <a[^>]*>Webflow</a></div>', '', content)
content = re.sub(r'<div className="body-s text-color-secondary-light">Designed by <a[^>]*>Human Made</a></div>', '<div className="body-s text-color-secondary-light">Built for Bit N Build</div>', content)

with open(r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('Texts updated!')
