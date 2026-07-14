/* ============================================================
   Paper presets — edit this file to add / change presets.

   Each preset:
     id            unique string
     name          label shown in the dropdown
     totalMinutes  exam duration; also fills the "Total exam time" field
     groups        question groups, each: { marks, count, minutes? }
                     - marks   : marks per question in this group
                     - count   : how many such questions
                     - minutes : OPTIONAL fixed time per question.
                                 If omitted, it's auto-computed from the total
                                 time, proportional to marks (sums to total).
   ============================================================ */
const PRESETS = [
    {
        id: "gs-mock",
        name: "GS Mocks (4×10m + 3×15m)",
        totalMinutes: 60,
        groups: [
            { marks: 10, count: 4, minutes: 7.1 },
            { marks: 15, count: 3, minutes: 10.5 },
        ],
    },
    {
        id: "gs-mains",
        name: "GS Mains (10×10m + 10×15m)",
        totalMinutes: 180,
        groups: [
            { marks: 10, count: 10, minutes: 7.5 },
            { marks: 15, count: 10, minutes: 10.5 },
        ],
    },
    {
        id: "essay",
        name: "Essay (2 × 125m)",
        totalMinutes: 180,
        groups: [
            { marks: 125, count: 2 }, // minutes omitted -> auto 90 each
        ],
    },
    {
        id: "prelims-gs",
        name: "Prelims GS (100 MCQ)",
        totalMinutes: 120,
        groups: [
            { marks: 2, count: 100 }, // -> 1.2 min each
        ],
    },
    {
        id: "prelims-csat",
        name: "Prelims CSAT (80 MCQ)",
        totalMinutes: 120,
        groups: [
            { marks: 2.5, count: 80 }, // -> 1.5 min each
        ],
    },
];