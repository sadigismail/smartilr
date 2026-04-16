// ─────────────────────────────────────────────────────────────────────────────
// config/rubricConfig.js
//
// All editable templates for the Auto Rubric Justification section (Section 8).
//
// Structure:
//   RUBRIC_DESCRIPTORS  — per-category, per-level descriptor strings
//   RUBRIC_SUMMARIES    — per-level "why assigned / why not lower / why not higher"
//
// Each template is a plain string; the engine selects the right one based on
// finalLevel and signal state.  To edit wording, only this file needs changing.
//
// ILR level keys used throughout:
//   "0+"  "1"  "1+"  "2"  "2+"  "3"  "3+"  "4"  "4+"  "5"
// ─────────────────────────────────────────────────────────────────────────────

// ── Per-category descriptor templates ────────────────────────────────────────
//
// Each object maps ILR level → descriptor string.
// The descriptor is the short, rubric-style statement of what is required
// at this level for this category.  It does not cite specific signals.

export const RUBRIC_DESCRIPTORS = Object.freeze({

  mainIdea: {
    "0+": "The main idea, if present, is formulaic or limited to a single word or phrase; no integrative reading is required.",
    "1":  "The main idea is directly and explicitly stated within individual sentences; no cross-sentence integration is required to identify it.",
    "1+": "The main idea is accessible through connected sentence reading; limited sequential tracking is required, but paragraph-level synthesis is not.",
    "2":  "The main idea is organized at the paragraph level and requires the reader to integrate information across several connected sentences or within a single paragraph.",
    "2+": "The main idea spans multiple paragraphs and requires active integration with the supporting argumentation; it is not fully accessible from any single passage segment.",
    "3":  "The main idea is distributed across extended, layered discourse and must be synthesized from overlapping sub-arguments; it may not be explicitly stated anywhere in the text.",
    "3+": "The main idea requires sustained cross-paragraph synthesis of abstract concepts; the reader must hold and integrate multiple argumentative threads simultaneously to reconstruct a central thesis that is never stated directly.",
    "4":  "The main idea is embedded within dense, conceptually layered discourse in which the central claim is carried implicitly through the structure and stance of the text; reconstruction requires integrating authorial position with high-density conceptual content.",
    "4+": "The main idea is carried as much by rhetorical form as by propositional content; the reader must interpret stylistic choices, tonal stance, and non-linear structure as co-constitutive elements of meaning rather than as vehicles for a separable central claim.",
    "5":  "The main idea operates at the level of full native-speaker intellectual discourse; its reconstruction demands simultaneous processing of rhetorical, conceptual, and argumentative layers, with no aspect of the text serving a merely decorative or redundant function.",
  },

  supportingDetail: {
    "0+": "Details, if present, are isolated or formulaic and can be identified without reference to surrounding text.",
    "1":  "Supporting details are explicitly stated and retrievable within individual sentences without reference to surrounding context.",
    "1+": "Details are distributed across connected sentences and require sequential reading to locate, but remain explicitly stated.",
    "2":  "Details are embedded within paragraph structure and require integration with the main idea to be accurately interpreted; surface extraction is not sufficient.",
    "2+": "Comprehension requires integrating supporting information with the main idea at the paragraph level; key details may not be uniformly explicit or may require inferential connection.",
    "3":  "Supporting details are functionally inseparable from the argument structure and require sustained inferential reconstruction; they cannot be extracted without comprehending the surrounding discourse.",
    "3+": "Details operate as constituent elements of an abstract conceptual architecture; they cannot be located or interpreted without sustained cross-paragraph inference and reconstruction of the relationship between sustained abstractions.",
    "4":  "Supporting details are densely packed and conceptually interdependent; their significance is carried implicitly through authorial stance and the layered argumentative structure, not through explicit signaling.",
    "4+": "Details and rhetorical moves are indistinguishable; what functions as a supporting detail at one level simultaneously functions as a rhetorical act at another. Comprehension requires processing this dual function.",
    "5":  "No detail is incidental; every element — including structural, tonal, and lexical choices — functions as load-bearing evidence within a fully integrated, rhetorically sophisticated argument accessible only to proficient native-level readers.",
  },

  inference: {
    "0+": "No inference is required; the passage, if meaningful, is fully explicit.",
    "1":  "Inference is not required; the passage remains entirely explicit and concrete. Comprehension does not involve reconstruction of unstated meaning.",
    "1+": "Inference is limited and local: the reader may need to bridge minor gaps between adjacent sentences, but no sustained inferential reasoning is required.",
    "2":  "Limited inference is required at one or more points to bridge the gap between explicitly stated information and implied meaning, but the passage does not demand systematic reconstruction of unstated content.",
    "2+": "Moderate to significant inference is required; implied meanings must be reconstructed beyond what is directly stated, though the inferential demands are not pervasive or sustained throughout the passage.",
    "3":  "Heavy inference is required throughout; the reader must actively reconstruct unstated relationships, withheld reasoning, and implicit argumentative moves. Comprehension cannot be achieved by processing only what is stated.",
    "3+": "Sustained cross-paragraph inference is required; the reader must hold abstract conceptual threads across the entire text and integrate them into a coherent interpretive framework that the text itself never makes explicit.",
    "4":  "Inference demand is very high and conceptually dense; the reader must reconstruct an implicit authorial stance embedded within layered argument and interpret unstated implications at every level of the discourse.",
    "4+": "Inference extends to the rhetorical and stylistic level; the reader must infer meaning from what is withheld, from tonal indirection, and from the form of the argument itself — not merely from its propositional content.",
    "5":  "The inferential demand is at the maximum of the ILR scale; comprehension requires the simultaneous reconstruction of explicit meaning, implicit argument, authorial stance, rhetorical strategy, and subtextual implication.",
  },

  discourseOrganization: {
    "0+": "Discourse organization is absent or minimal; the passage consists of isolated items without a connective structure.",
    "1":  "The discourse is not organized at the sentence-connection level; each sentence is largely independent. No tracking of inter-sentence relationships is required.",
    "1+": "The discourse is organized linearly through connected sentences; the reader follows a sequential chain of related information without needing to track paragraph-level structure.",
    "2":  "The discourse is organized at the paragraph level with a coherent internal structure; comprehension requires tracking the organization of a unified paragraph but not extended multi-paragraph development.",
    "2+": "The discourse develops across multiple paragraphs with each section building on prior content; paragraph-to-paragraph dependency means the organizational sequence cannot be disrupted without loss of meaning.",
    "3":  "The discourse is organized through sustained, non-linear development: sub-arguments, qualifications, and reframings create a layered structure that does not yield to linear scanning and requires active tracking of the argumentative architecture.",
    "3+": "The organizational structure is fully cross-paragraph and abstract; the reader must reconstruct a non-linear argumentative architecture in which earlier sections are recontextualized by later ones, requiring backward and forward integration simultaneously.",
    "4":  "The discourse structure is dense and conceptually layered; organizational signals are minimal and the reader must infer structural relationships from the evolution of an implicit argument rather than from explicit discourse markers.",
    "4+": "Organization is itself a rhetorical act; the structure of the discourse — the sequencing, the pacing, the strategic silences — carries meaning independent of its propositional content. The reader must process organization as argument.",
    "5":  "The organizational architecture is fully native-speaker level; structural complexity, rhetorical design, and argumentative layering are inseparable, and the full meaning of the text cannot be reconstructed without comprehending all three simultaneously.",
  },

  vocabularyAbstraction: {
    "0+": "Vocabulary is extremely limited or formulaic; no abstraction is present.",
    "1":  "Vocabulary is primarily concrete and accessible; lexical items refer to observable objects, actions, or states. No abstraction is required to process meaning.",
    "1+": "Vocabulary includes some terms beyond the most common core but remains largely concrete; any abstractions are grounded in concrete or familiar contexts.",
    "2":  "The vocabulary includes moderate abstraction but remains structurally accessible; terms may require contextual interpretation without demanding recognition of theoretical or specialized discourse.",
    "2+": "The vocabulary operates at a level of abstraction that requires the reader to process conceptual relationships rather than simply recognising surface meanings; key terms may be polysemous or discourse-dependent.",
    "3":  "The vocabulary is highly abstract, conceptually dense, or embedded in specialized discourse; meaning is inseparable from the argumentative context, and recognition of dictionary definitions is insufficient for comprehension.",
    "3+": "Vocabulary operates at the level of sustained philosophical or intellectual abstraction; terms function as nodes within a conceptual network that the reader must actively construct in order for individual lexical items to become interpretable.",
    "4":  "The lexical register is very high and conceptually dense; key terms carry implicit argumentative weight and cannot be processed by definitional recognition alone — their meaning is fully discourse-dependent and stance-loaded.",
    "4+": "Vocabulary is inseparable from rhetorical effect; word choices carry tonal, ironic, or evaluative force that functions independently of their propositional meaning. Processing the vocabulary requires sensitivity to register, connotation, and rhetorical intent simultaneously.",
    "5":  "The full range of native-speaker vocabulary is deployed with precision; lexical density, register variation, and semantic layering reach the upper limit of what the language makes available, and no simplification is present at any level.",
  },

  tonePurpose: {
    "0+": "Tone and purpose, if identifiable, are formulaic and require no interpretive reading.",
    "1":  "The tone is neutral and the purpose is transparent; the text does not require the reader to identify an authorial stance or interpret rhetorical intent.",
    "1+": "The tone and purpose are accessible from direct reading; any evaluation or stance is explicitly signaled through lexical choice and does not require sustained interpretation.",
    "2":  "The author's tone and purpose are identifiable but require the reader to track evaluative language across the passage rather than from a single phrase or sentence.",
    "2+": "Identifying the tone and purpose requires the reader to integrate evaluative signals distributed across the passage; the stance may not be explicitly named and requires inferential reconstruction.",
    "3":  "The author's stance is indirect and embedded in rhetorical and structural choices; the reader cannot rely on explicit evaluative vocabulary and must infer the purpose through sustained interpretive engagement with the discourse.",
    "3+": "The author's stance is fully implicit and must be reconstructed from the abstract conceptual framework the text constructs; tone is inseparable from the argumentative architecture and can only be identified through full cross-paragraph synthesis.",
    "4":  "Purpose and stance are embedded within dense conceptual discourse; the reader must infer the author's evaluative position from the structure and weight of the argument itself, not from any explicitly evaluative language.",
    "4+": "Tone is a primary carrier of meaning; irony, indirection, and rhetorical positioning operate as argumentative strategies rather than as stylistic embellishments. Comprehension of purpose requires sensitivity to all these dimensions simultaneously.",
    "5":  "The author's purpose and tone operate at the full complexity of native-speaker intellectual discourse; identifying either requires integrating propositional content, rhetorical strategy, intertextual positioning, and implied ideological stance.",
  },

  overallDemand: {
    "0+": "Overall comprehension demand is minimal; the passage is formulaic or pre-linguistic in nature and does not require active reading beyond recognition of individual items.",
    "1":  "Overall comprehension demand is low; the text is explicit, self-contained, and processable at the sentence level without any cross-sentence or inferential integration.",
    "1+": "Overall comprehension demand is moderate-low; connected discourse requires sequential sentence-level tracking and limited local inference, but does not engage paragraph-level or inferential reading skills.",
    "2":  "Overall comprehension demand is moderate; paragraph-level integration, inter-sentence dependency, and some inferential reading are required, placing this passage at a level appropriate for intermediate proficiency.",
    "2+": "Overall comprehension demand is moderate-high; multi-paragraph integration, conceptual abstraction, and sustained inferential engagement are all required, placing sustained demands on active reading.",
    "3":  "Overall comprehension demand is high; the passage requires sustained engagement with extended, layered discourse, non-linear organization, and pervasive inference.",
    "3+": "Overall comprehension demand is very high; the passage requires sustained cross-paragraph reconstruction of abstract conceptual relationships that are never made explicit, combined with simultaneous tracking of the full argumentative architecture.",
    "4":  "Overall comprehension demand is at the upper range of the ILR scale; dense conceptual content, implicit authorial stance, and layered non-linear argument combine to produce a text that cannot be processed without high-level interpretive competence.",
    "4+": "Overall comprehension demand is near maximum; meaning is carried simultaneously by propositional content, rhetorical structure, tonal stance, and stylistic choice, requiring the reader to operate across all these levels without scaffolding.",
    "5":  "Overall comprehension demand is at the maximum of the ILR scale; the text places the full range of native-speaker interpretive demands on the reader simultaneously, with no reduction in complexity, register, or rhetorical sophistication at any point.",
  },

});

// ── Per-level summary templates ───────────────────────────────────────────────
//
// Each object provides:
//   assigned  — why this level was assigned (compact ILR-style statement)
//   notLower  — why the passage is not at the level below (or null at minimum)
//   notHigher — why the passage is not at the level above (or null at maximum)

export const RUBRIC_SUMMARIES = Object.freeze({

  "0+": {
    assigned:  "Assigned because the language is formulaic, minimally connected, or pre-linguistic, placing it below the threshold of connected sentence-level discourse.",
    notLower:  null,
    notHigher: "The passage does not present complete, connected sentences required for ILR 1.",
  },

  "1": {
    assigned:  "Assigned because the passage consists of explicit, discrete sentences that are comprehensible without cross-sentence integration.",
    notLower:  "The passage presents complete, meaningful sentences rather than isolated items or formulaic content that would characterize ILR 0+.",
    notHigher: "The passage does not require cross-sentence reference tracking, connected discourse interpretation, or any form of local inference characteristic of ILR 1+.",
  },

  "1+": {
    assigned:  "Assigned because the passage presents connected discourse that requires tracking cross-sentence relationships and limited local inference.",
    notLower:  "The passage requires cross-sentence relation tracking rather than isolated sentence processing; comprehension depends on following a connected sequence of ideas.",
    notHigher: "The passage does not require full paragraph-level integration, sustained inferential reasoning, or the organizational complexity characteristic of ILR 2.",
  },

  "2": {
    assigned:  "Assigned because the passage requires paragraph-level integration of connected information with limited inferential demands.",
    notLower:  "The passage requires the reader to track information across multiple connected sentences and integrate it at the paragraph level, exceeding ILR 1+ sentence-level tracking.",
    notHigher: "The passage does not require multi-paragraph integration, sustained abstraction, or the inferential density and organizational complexity characteristic of ILR 2+.",
  },

  "2+": {
    assigned:  "Assigned because the passage demands multi-paragraph integration with moderate abstraction and implied meanings that go beyond straightforward explanation.",
    notLower:  "Implied meanings and conceptual integration exceed what can be achieved through straightforward paragraph-level comprehension at ILR 2; inferential engagement is required.",
    notHigher: "The discourse is not sufficiently extended, layered, or inferentially dense to satisfy the conditions for ILR 3; the argument remains accessible without requiring sustained reconstruction of unstated meaning.",
  },

  "3": {
    assigned:  "Assigned because the passage demands sustained engagement with extended, layered discourse requiring reconstruction of implicit meaning and integration of complex sub-arguments.",
    notLower:  "The density of implicit meaning, layered argumentative structure, and pervasive inferential demands exceed what can be accommodated at ILR 2+; the discourse is not accessible without active reconstruction of unstated relationships.",
    notHigher: "The passage does not exhibit the sustained cross-paragraph abstraction and simultaneous multi-thread inference integration required for ILR 3+; the argumentative structure, while complex, does not demand that level of synthesizing comprehension.",
  },

  "3+": {
    assigned:  "Assigned because the passage demands sustained cross-paragraph synthesis of abstract conceptual threads, requiring the reader to hold and integrate multiple lines of argument simultaneously without explicit structural scaffolding.",
    notLower:  "The degree of sustained abstraction and cross-paragraph inferential integration exceeds ILR 3; the reader must reconstruct a conceptual architecture that spans the entire text without any explicit unifying statement.",
    notHigher: "The passage does not reach the level of conceptual density, implicit authorial stance, and layered argument simultaneously required for ILR 4.",
  },

  "4": {
    assigned:  "Assigned because the passage presents dense, conceptually layered argument with an implicit authorial stance that must be reconstructed from the structure and weight of the discourse itself, not from any explicit evaluative language.",
    notLower:  "The conceptual density and implicitly embedded stance of this passage exceed ILR 3+; comprehension requires processing an argumentative architecture in which every element carries implicit argumentative and evaluative weight.",
    notHigher: "The passage does not reach the level of rhetorical nuance and stylistic sophistication simultaneously required for ILR 4+; meaning is primarily carried by conceptual content rather than by rhetorical and stylistic form.",
  },

  "4+": {
    assigned:  "Assigned because the passage carries meaning simultaneously through propositional content, rhetorical structure, tonal stance, and stylistic choice; comprehension requires operating across all these levels without scaffolding.",
    notLower:  "The rhetorical nuance and stylistic sophistication of this passage exceed ILR 4; the form of the argument is itself a primary carrier of meaning, independent of its propositional content.",
    notHigher: "The passage does not reach the full native-speaker intellectual discourse complexity of ILR 5, in which every dimension — conceptual, rhetorical, tonal, and structural — operates simultaneously at maximum load.",
  },

  "5": {
    assigned:  "Assigned because the passage operates at the full complexity of native-speaker intellectual discourse; no dimension — conceptual, rhetorical, tonal, or structural — is simplified, and all layers must be processed simultaneously for comprehension.",
    notLower:  "The passage places the full range of native-speaker interpretive demands on the reader simultaneously, exceeding ILR 4+; no aspect of the text is accessible through partial processing or selective attention to a subset of its meaning-carrying layers.",
    notHigher: null,
  },

});

// ── Category display metadata ─────────────────────────────────────────────────
//
// Render order, label text, and description for each rubric category.
// The `key` must match the key used in RUBRIC_DESCRIPTORS.

export const RUBRIC_CATEGORY_META = Object.freeze([
  {
    key:         "mainIdea",
    label:       "Main Idea",
    description: "What level of comprehension is required to identify and understand the central idea of the passage.",
  },
  {
    key:         "supportingDetail",
    label:       "Supporting Detail",
    description: "How details are organized and what reading strategies are needed to locate and interpret them.",
  },
  {
    key:         "inference",
    label:       "Inference",
    description: "The degree to which the reader must reconstruct meaning beyond what is directly stated.",
  },
  {
    key:         "discourseOrganization",
    label:       "Discourse Organisation",
    description: "The complexity of the text's overall organizational structure and what tracking it requires.",
  },
  {
    key:         "vocabularyAbstraction",
    label:       "Vocabulary / Abstraction",
    description: "The register, abstractness, and conceptual density of the vocabulary in context.",
  },
  {
    key:         "tonePurpose",
    label:       "Tone / Purpose",
    description: "How transparent the author's intent and stance are, and what interpretive skill is required to identify them.",
  },
  {
    key:         "overallDemand",
    label:       "Overall Comprehension Demand",
    description: "A synthesis of all dimensions into a single statement of the passage's overall reading or listening demand.",
  },
]);
