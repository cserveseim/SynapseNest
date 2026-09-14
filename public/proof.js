(() => {
  const parts = location.pathname.split('/').filter(Boolean);
  const [root, encodedProjectId, encodedSynapseId] = parts;
  const set = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value || '';
  };

  if (root !== 'proof' || !encodedProjectId || !encodedSynapseId) {
    return showError('This proof link is incomplete.');
  }

  const projectId = decodeURIComponent(encodedProjectId);
  const synapseId = decodeURIComponent(encodedSynapseId);

  fetch(`/api/proof/${encodeURIComponent(projectId)}/${encodeURIComponent(synapseId)}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'This proof is unavailable.');
      return payload;
    })
    .then((proof) => {
      set('#proofTitle', proof.title || 'Sealed identity');
      set(
        '#proofDescription',
        proof.mission
          ? 'Identity travels. Hardware follows.'
          : 'A published Project Genome.',
      );
      set('#missionText', proof.mission || proof.description || 'No mission recorded.');
      set('#contractId', proof.contractId || '—');
      set('#guardianFp', proof.guardianFp || '—');
      set('#projectName', proof.projectId || projectId);
      set('#synapseName', proof.synapseName || proof.synapseId || synapseId);
      set('#runtimeText', proof.runtime || 'unknown');
      set(
        '#hardwareNote',
        proof.runtime === 'stub'
          ? 'Hardware deferred — identity sealed'
          : proof.publishedAt
            ? `Published ${proof.publishedAt}`
            : '',
      );
      document.querySelector('#proofCard').hidden = false;
    })
    .catch((error) => showError(error.message));

  function showError(message) {
    set('#proofTitle', 'Proof unavailable');
    set('#proofDescription', 'This link cannot be verified.');
    set('#proofError', message);
    document.querySelector('#proofError').hidden = false;
  }
})();
