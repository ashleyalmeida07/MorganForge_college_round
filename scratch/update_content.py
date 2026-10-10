import os

file_path = r'c:\Users\Ashley\OneDrive\Documents\Projects\bnb\frontend\src\app\page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

replacements = {
    "Why Securio": "Why Verity",
    "Proactive Security": "Verifiable Compute",
    "Stop threats before impact": "Optimistic off-chain execution",
    "Penetration Testing": "Bisection Protocol",
    "Test defenses against real threats": "Interactive on-chain dispute resolution",
    "Endpoint Security": "Tamper-Evident",
    "Keep systems and users protected": "Merkle-committed execution traces",
    "Talk to a <br />\n                              Security Expert": "Read the <br />\n                              Whitepaper",
    "Plan your next steps": "Learn how it works",
    "SECURITY SERVICES": "CORE FEATURES",
    "Every action visible. <br />\n                Every decision defensible.": "Trustless execution. <br />\n                Deterministic verification.",
    "Threats handled before the team wakes up.": "Optimistic execution with a Merkle-committed step trace.",
    "Know what&#x27;s coming before it arrives.": "Interactive bisection game narrowing to one disputed step.",
    "Every device protected. Every edge secured.": "Anyone can replay locally and challenge on-chain.",
    "Cyber defense process designed for real threats": "Verifiable computation lifecycle",
    "Discovery": "Request Computation",
    "We assess your systems, workflows, risks, and business goals to find weak points, define priorities, and create a clear security baseline before any work begins.": "A user requests a computation (e.g. statistical aggregate over a dataset) by submitting the data Merkle root, program hash, and an escrowed reward.",
    "Design &amp; Architecture": "Off-Chain Execution",
    "We map the right controls, workflows, response paths, and security structure around your environment so every decision supports visibility, resilience, and scale.": "The Provider runs the deterministic computation off-chain and publishes a Merkle root over every intermediate state (the execution trace) plus the final result.",
    "Implementation": "Verification & Dispute",
    "We deploy, test, and refine the solution across your systems, making sure each control works in practice and supports response, monitoring, and long-term protection.": "During the challenge window, anyone can replay the computation. If they disagree, a bisection game pinpoints the single invalid step for on-chain resolution.",
    "verity solution suite": "Verity guarantees",
    "Trusted outcomes.": "Security properties",
    "Threat Intelligence": "Soundness",
    "We monitor threat signals, analyze patterns, and help your team understand which risks need attention before they become incidents.": "An incorrect result is rejected if at least one honest challenger acts within the window.",
    "Identity Protection": "Input Integrity",
    "We help protect user access, reduce account misuse, and make sure the right people can reach the right systems safely.": "Every consumed data element is verified against the initial dataset Merkle root.",
    "Network Defense": "Program Integrity",
    "We strengthen your network controls, reduce exposure, and help block suspicious activity before it reaches critical systems.": "The program hash is fixed at job creation. The contract only supports registered step functions.",
    "Incident Response": "Liveness",
    "We help your team contain threats, investigate activity, and restore control with a clear response process when incidents happen.": "Timeouts on every party action guarantee that no funds are ever locked forever.",
    "Data Protection": "Tamper Evidence",
    "We protect sensitive business data across systems, devices, and workflows with controls built around real security risks.": "All commitments and verdicts are emitted as on-chain events and are immutable.",
    "Security Analytics": "Dispute Resolution",
    "We turn security data into clear insights, helping your team detect issues faster and make better security decisions.": "The interactive bisection game ensures only a single step of computation is run on-chain.",
    "CASE STUDIES": "ADVERSARIAL SCENARIOS",
    "Client success stories": "Tested against malicious actors",
    "Modernizing DevOps FinTech Security": "Forged Trace Detection",
    "Modernizing Healthcare Security with SecOps": "Invalid Result Slashing",
    "Securing Enterprise Data at Scale": "Wrong Input Data Rejection",
    "What types of cyber threats do you protect against?": "What is verifiable computation?",
    "We help protect against phishing, malware, ransomware, account misuse, data exposure, network attacks, and suspicious activity across your systems.": "It allows a user to outsource a computation and verify the result is correct without re-running the entire computation.",
    "How quickly can you detect and respond to an attack?": "What happens if the provider cheats?",
    "Response time depends on your environment and service scope, but our process is built to detect threats early, prioritize risk, and act quickly.": "Any challenger can dispute the result. A bisection game isolates the exact faulty step, which is re-run on-chain, slashing the provider's bond.",
    "Do you provide 24/7 monitoring and support?": "Why not just run it all on-chain?",
    "Yes. We can provide continuous monitoring and support to help your team identify issues, review alerts, and respond when activity needs attention.": "On-chain computation is extremely expensive and gas-limited. Verity scales this by running computation off-chain and only using the blockchain as a dispute resolution layer.",
    "Can your solutions scale as our business grows?": "Does this require ZK-Proofs?",
    "Yes. Our services are built to support changing teams, systems, locations, and risk levels as your business grows and your security needs expand.": "No, the MVP relies on optimistic execution and interactive fraud proofs (like Optimistic Rollups). A ZK-SNARK path can be added as a stretch goal.",
    "How do you ensure compliance with industry standards?": "Who can challenge a result?",
    "We align security controls, reporting, and processes with relevant standards, helping your team reduce gaps and stay audit-ready.": "Anyone! Verity uses a 1-of-N trust model. As long as there is at least one honest verifier online during the challenge window, the system is secure.",
    "How do you onboard and integrate with our existing infrastructure?": "What are the limitations?",
    "We review your current tools, systems, and workflows first, then integrate security controls without disrupting your daily operations.": "It requires at least one honest, online verifier during the window. It also does not hide inputs, as we prove correctness, not confidentiality.",
    "What level of visibility and reporting will we have?": "What computation is supported?",
    "You get clear reporting on risks, alerts, activity, and progress, so your team can understand what is happening and what needs attention.": "Currently, deterministic statistical aggregates over datasets (e.g. mean and variance), utilizing fixed-point integer math to guarantee identical state hashes.",
    "Request a free  security audit": "Start verifying  computations",
    "Take security from reactive to proactive": "Prove the computation, not just the result."
}

# Apply replacements one by one
for old, new in replacements.items():
    content = content.replace(old, new)

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Updates applied.")
