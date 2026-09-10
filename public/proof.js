(() => {
  const parts = location.pathname.split('/').filter(Boolean);
  const [_, encodedProjectId, encodedSynapseId] = parts;
  const set = (selector, value) => { document.querySelector(selector).textContent = value; };

  if (_ !== 'proof' || !encodedProjectId || !encodedSynapseId) return showError('This proof link is incomplete.');
  fetch(`/api/projects/${encodedProjectId}`)
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'This Project Genome is unavailable.');
      return payload.project;
    })
    .then((project) => {
      const synapseId = decodeURIComponent(encodedSynapseId);
      const publication = project.publications.find((item) => item.synapseId === synapseId);
      const synapse = project.synapses.find((item) => item.id === synapseId);
      if (!publication || !synapse) throw new Error('This synapse has not been published.');
      set('#proofTitle', project.title);
      set('#proofDescription', project.description || 'A published Project Genome.');
      set('#synapseName', synapse.name);
      set('#synapseNote', synapse.note || 'No experiment note was recorded.');
      set('#projectName', project.title);
      set('#publishedAt', new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(publication.publishedAt)));
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
