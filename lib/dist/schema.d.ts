import { z } from "zod";
export declare const resultSchema: z.ZodObject<{
    intent: z.ZodEnum<{
        answer: "answer";
        supplement: "supplement";
        revise: "revise";
        confirm: "confirm";
        explain: "explain";
        pause: "pause";
        skip: "skip";
        correct_question: "correct_question";
        resume: "resume";
    }>;
    assessments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        targetId: z.ZodString;
        status: z.ZodEnum<{
            unstarted: "unstarted";
            partial: "partial";
            sufficient: "sufficient";
            uncertain: "uncertain";
            skipped: "skipped";
            exhausted: "exhausted";
            conflict: "conflict";
        }>;
        summary: z.ZodString;
        gaps: z.ZodArray<z.ZodString>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        stage: z.ZodEnum<{
            definition: "definition";
            knowledge: "knowledge";
            methods: "methods";
            service: "service";
        }>;
        kind: z.ZodEnum<{
            chapter: "chapter";
            hypothesis: "hypothesis";
            scenario: "scenario";
            blueprint: "blueprint";
            transition: "transition";
        }>;
        title: z.ZodString;
        markdown: z.ZodString;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        dependencies: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unresolved: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>>;
    confirmation: z.ZodOptional<z.ZodObject<{
        target: z.ZodObject<{
            scope: z.ZodEnum<{
                object: "object";
                booklet: "booklet";
            }>;
            stage: z.ZodEnum<{
                definition: "definition";
                knowledge: "knowledge";
                methods: "methods";
                service: "service";
            }>;
            objects: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                hash: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        decision: z.ZodEnum<{
            confirmed: "confirmed";
            accepted: "accepted";
            rejected: "rejected";
        }>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    majorChange: z.ZodOptional<z.ZodObject<{
        affectedTargets: z.ZodArray<z.ZodString>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        reason: z.ZodEnum<{
            positioning: "positioning";
            audience: "audience";
            core_task: "core_task";
        }>;
    }, z.core.$strict>>;
    sourcePlan: z.ZodOptional<z.ZodObject<{
        requiredKinds: z.ZodArray<z.ZodEnum<{
            file: "file";
            webpage: "webpage";
            xiaohongshu: "xiaohongshu";
            history: "history";
            mindmap: "mindmap";
            skill: "skill";
            oral: "oral";
            scan: "scan";
            audio: "audio";
            video: "video";
        }>>;
        sourceIds: z.ZodArray<z.ZodString>;
        discoveryClosed: z.ZodBoolean;
    }, z.core.$strict>>;
    sourceVersions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
    }, z.core.$strict>>>;
    serviceMode: z.ZodOptional<z.ZodEnum<{
        smart: "smart";
        guided: "guided";
    }>>;
    serviceModelExplained: z.ZodOptional<z.ZodBoolean>;
    delivery: z.ZodObject<{
        text: z.ZodString;
        mode: z.ZodOptional<z.ZodEnum<{
            transition: "transition";
            booklet: "booklet";
            ordinary: "ordinary";
            example: "example";
            explanation: "explanation";
        }>>;
        questionTargetId: z.ZodOptional<z.ZodString>;
        confirmationObjectIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        confirmationScope: z.ZodOptional<z.ZodEnum<{
            object: "object";
            booklet: "booklet";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const resultJsonSchema: z.core.ZodStandardJSONSchemaPayload<z.ZodObject<{
    intent: z.ZodEnum<{
        answer: "answer";
        supplement: "supplement";
        revise: "revise";
        confirm: "confirm";
        explain: "explain";
        pause: "pause";
        skip: "skip";
        correct_question: "correct_question";
        resume: "resume";
    }>;
    assessments: z.ZodOptional<z.ZodArray<z.ZodObject<{
        targetId: z.ZodString;
        status: z.ZodEnum<{
            unstarted: "unstarted";
            partial: "partial";
            sufficient: "sufficient";
            uncertain: "uncertain";
            skipped: "skipped";
            exhausted: "exhausted";
            conflict: "conflict";
        }>;
        summary: z.ZodString;
        gaps: z.ZodArray<z.ZodString>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>>;
    artifacts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        stage: z.ZodEnum<{
            definition: "definition";
            knowledge: "knowledge";
            methods: "methods";
            service: "service";
        }>;
        kind: z.ZodEnum<{
            chapter: "chapter";
            hypothesis: "hypothesis";
            scenario: "scenario";
            blueprint: "blueprint";
            transition: "transition";
        }>;
        title: z.ZodString;
        markdown: z.ZodString;
        data: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        dependencies: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unresolved: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>>;
    confirmation: z.ZodOptional<z.ZodObject<{
        target: z.ZodObject<{
            scope: z.ZodEnum<{
                object: "object";
                booklet: "booklet";
            }>;
            stage: z.ZodEnum<{
                definition: "definition";
                knowledge: "knowledge";
                methods: "methods";
                service: "service";
            }>;
            objects: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                hash: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        decision: z.ZodEnum<{
            confirmed: "confirmed";
            accepted: "accepted";
            rejected: "rejected";
        }>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    majorChange: z.ZodOptional<z.ZodObject<{
        affectedTargets: z.ZodArray<z.ZodString>;
        evidence: z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<{
                input: "input";
                artifact: "artifact";
                source: "source";
            }>;
            id: z.ZodString;
            hash: z.ZodString;
            quote: z.ZodOptional<z.ZodString>;
            locator: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        reason: z.ZodEnum<{
            positioning: "positioning";
            audience: "audience";
            core_task: "core_task";
        }>;
    }, z.core.$strict>>;
    sourcePlan: z.ZodOptional<z.ZodObject<{
        requiredKinds: z.ZodArray<z.ZodEnum<{
            file: "file";
            webpage: "webpage";
            xiaohongshu: "xiaohongshu";
            history: "history";
            mindmap: "mindmap";
            skill: "skill";
            oral: "oral";
            scan: "scan";
            audio: "audio";
            video: "video";
        }>>;
        sourceIds: z.ZodArray<z.ZodString>;
        discoveryClosed: z.ZodBoolean;
    }, z.core.$strict>>;
    sourceVersions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodString;
    }, z.core.$strict>>>;
    serviceMode: z.ZodOptional<z.ZodEnum<{
        smart: "smart";
        guided: "guided";
    }>>;
    serviceModelExplained: z.ZodOptional<z.ZodBoolean>;
    delivery: z.ZodObject<{
        text: z.ZodString;
        mode: z.ZodOptional<z.ZodEnum<{
            transition: "transition";
            booklet: "booklet";
            ordinary: "ordinary";
            example: "example";
            explanation: "explanation";
        }>>;
        questionTargetId: z.ZodOptional<z.ZodString>;
        confirmationObjectIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        confirmationScope: z.ZodOptional<z.ZodEnum<{
            object: "object";
            booklet: "booklet";
        }>>;
    }, z.core.$strict>;
}, z.core.$strict>>;
