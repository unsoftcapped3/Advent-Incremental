import Spacer from "components/layout/Spacer.vue";
import Fraction from "components/math/Fraction.vue";
import Sqrt from "components/math/Sqrt.vue";
import Modal from "components/Modal.vue";
import { createCollapsibleMilestones, createCollapsibleModifierSections } from "data/common";
import { main } from "data/projEntry";
import { createBar, GenericBar } from "features/bars/bar";
import { createBuyable } from "features/buyable";
import { createClickable } from "features/clickables/clickable";
import { jsx, showIf } from "features/feature";
import { createMilestone, GenericMilestone } from "features/milestones/milestone";
import { createUpgrade } from "features/upgrades/upgrade";
import { globalBus } from "game/events";
import { createLayer } from "game/layers";
import {
    createAdditiveModifier,
    createMultiplicativeModifier,
    createSequentialModifier,
    Modifier
} from "game/modifiers";
import { persistent } from "game/persistence";
import Decimal, { DecimalSource, format, formatTime, formatWhole } from "util/bignum";
import { Direction } from "util/common";
import { render, renderCol, renderGrid } from "util/vue";
import { computed, ComputedRef, ref, Ref } from "vue";
import elves from "./elves";
import trees from "./trees";
import paper from "./paper";
import boxes from "./boxes";
import cloth from "./cloth";
import coal from "./coal";
import dyes from "./dyes";
import metal from "./metal";
import plastic from "./plastic";

const id = "management";
const day = 12;
const advancedDay = 13;

const layer = createLayer(id, () => {
    const name = "Management";
    const color = "green"; // idk what to do

    // ------------------------------------------------------------------------------- Day Progress

    const dayProgress = createBar(() => ({
        direction: Direction.Right,
        width: 600,
        height: 25,
        fillStyle: `backgroundColor: ${color}`,
        progress: () =>
            main.day.value === day
                ? day12Elves.reduce((acc, curr) => acc + Math.min(1, curr.level.value / 3), 0) /
                  day12Elves.length
                : main.day.value === advancedDay
                ? day13Elves.reduce((acc, curr) => acc + Math.min(1, curr.level.value / 5), 0) /
                  day13Elves.length
                : 1,
        display: jsx(() =>
            main.day.value === day ? (
                <>
                    {formatWhole(totalElfLevels.value)}/{formatWhole(elves.totalElves.value * 5)}{" "}
                    elf levels
                </>
            ) : (
                ""
            )
        )
    })) as GenericBar;

    const totalElfLevels = computed(() => {
        let elfLevel = 0;
        for (const elf of Object.values(elfTraining)) {
            elfLevel += elf.level.value;
        }
        return elfLevel;
    });

    // ------------------------------------------------------------------------------- Upgrades

    const teaching = createUpgrade(() => ({
        display: {
            title: "Teach the Elves",
            description:
                "The Elves probably need to be taught if they're to do better. Maybe you'll build a school so you can teach them?"
        },
        resource: trees.logs,
        cost: 1e21
    }));

    const classroomUpgrade = createUpgrade(() => ({
        display: {
            title: "Add a Classroom?",
            description:
                "Yay, you have a school. Too bad it has pretty much nothing in it. Maybe you could add some classrooms to make it less boring and more enticing to the Elves?"
        },
        visibility: () => showIf(teaching.bought.value),
        resource: boxes.boxes,
        style: "width: 150px",
        cost: 1e13
    }));
    const globalXPModifier = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: () => classroomEffect.value,
            description: "Classroom Effect",
            enabled: () => classroomUpgrade.bought.value
        }))
    ]);
    const globalXPModifierComputed = globalXPModifier.apply(1);

    // ------------------------------------------------------------------------------- Training core function

    function createElfTraining(
        elf: {
            name: string;
            computedAutoBuyCooldown: ComputedRef<DecimalSource>;
            amountOfTimesDone: Ref<number>;
        },
        milestones: Array<GenericMilestone>,
        ...modifiers: Modifier[]
    ) {
        const exp = persistent<DecimalSource>(0);
        const expRequiredForNextLevel = computed(() => Decimal.pow(10, level.value).mul(1e4));
        const level = computed(() =>
            Decimal.min(
                Decimal.mul(9, exp.value).div(1e4).add(1).log10().floor(),
                schools.amount.value
            ).toNumber()
        );
        const expToNextLevel = computed(() =>
            Decimal.sub(exp.value, Decimal.pow(10, level.value).sub(1).div(9).mul(1e4))
        );
        const bar = createBar(() => ({
            direction: Direction.Right,
            width: 160,
            height: 12,
            style: () => ({
                "margin-top": "8px",
                "box-shadow": focusTargets.value[elf.name]
                    ? "0 0 12px " + (currentShown.value == elf.name ? "black" : "white")
                    : ""
            }),
            baseStyle: "margin-top: 0",
            fillStyle: "margin-top: 0; transition-duration: 0s",
            borderStyle: () =>
                Decimal.gte(level.value, schools.amount.value) ? "border-color: red" : "",
            progress: () => Decimal.div(expToNextLevel.value, expRequiredForNextLevel.value),
            display: jsx(() =>
                Decimal.gte(level.value, schools.amount.value) ? (
                    <>Limit reached</>
                ) : (
                    <>
                        {format(expToNextLevel.value)}/{format(expRequiredForNextLevel.value)} XP
                    </>
                )
            )
        }));
        const { collapseMilestones: state, display: displayMilestone } =
            createCollapsibleMilestones(milestones as Record<number, GenericMilestone>);
        const elfXPGain = createSequentialModifier(() => [
            createMultiplicativeModifier(() => ({
                multiplier: globalXPModifierComputed,
                description: "Global XP Multiplier"
            })),
            createMultiplicativeModifier(() => ({
                multiplier: focusMulti,
                description: "Focus Multiplier",
                enabled: () => Decimal.gt(focusTime.value, 0) && focusTargets.value[elf.name] == true
            })),
            ...modifiers
        ]);
        const elfXPGainComputed = computed(() => elfXPGain.apply(0.1));
        const click = createClickable(() => ({
            display: {
                title: elf.name,
                description: jsx(() => (
                    <>
                        {elf.name} is currently at level {formatWhole(level.value)}, and achieved a
                        total of {format(exp.value)} XP. They buy buyables{" "}
                        {formatWhole(elf.computedAutoBuyCooldown.value)} times per second, gaining{" "}
                        {Decimal.gte(level.value, schools.amount.value)
                            ? 0
                            : format(
                                  Decimal.mul(
                                      elfXPGainComputed.value,
                                      elf.computedAutoBuyCooldown.value
                                  )
                              )}{" "}
                        XP/sec.
                        {render(bar)}
                    </>
                ))
            },
            style: () => ({
                width: "190px",
                background: currentShown.value == elf.name ? "var(--foreground)" : ""
            }),
            onClick() {
                currentShown.value = elf.name;
            },
            canClick() {
                return currentShown.value !== elf.name;
            },
            name: elf.name,
            state,
            displayMilestone,
            level,
            exp,
            milestones,
            timeForExp: elf.computedAutoBuyCooldown,
            amountOfTimesDone: elf.amountOfTimesDone,
            elfXPGainComputed,
            elfXPGain
        }));
        return click;
    }

    // ------------------------------------------------------------------------------- Elf milestones

    const cutterElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Holly Level 1",
                effectDisplay: jsx(() => (
                    <>
                        Multiply log gain by <sup>3</sup>
                        <Sqrt>Cutter amount</Sqrt>.
                    </>
                ))
            },
            shouldEarn: () => cutterElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Holly Level 2",
                effectDisplay: "Holly now buys max."
            },
            visibility: () => showIf(cutterElfMilestones[0].earned.value),
            shouldEarn: () => cutterElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Holly Level 3",
                effectDisplay: jsx(() => (
                    <>
                        Multiply all cloth actions' effectiveness by <sup>3</sup>
                        <Sqrt>Cutter amount</Sqrt>.
                    </>
                ))
            },
            visibility: () => showIf(cutterElfMilestones[1].earned.value),
            shouldEarn: () => cutterElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Holly Level 4",
                effectDisplay: "Multiply auto cutting amount by 1.1 per day completed"
            },
            visibility: () => showIf(cutterElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => cutterElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Holly Level 5",
                effectDisplay: "Raise workshop expansion cost by 0.95"
            },
            visibility: () => showIf(cutterElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => cutterElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const planterElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Ivy Level 1",
                effectDisplay: "Planters are now twice as efficent."
            },
            shouldEarn: () => planterElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Ivy Level 2",
                effectDisplay: "Ivy now buys max."
            },
            visibility: () => showIf(planterElfMilestones[0].earned.value),
            shouldEarn: () => planterElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Ivy Level 3",
                effectDisplay: jsx(() => (
                    <>
                        Auto planting speed is multiplied by 2
                        <sup>
                            (log<sub>10</sub>(logs)<sup>0.2</sup>)
                        </sup>
                    </>
                ))
            },
            visibility: () => showIf(planterElfMilestones[1].earned.value),
            shouldEarn: () => planterElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Ivy Level 4",
                effectDisplay: "Divide planter cost by 10"
            },
            visibility: () => showIf(planterElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => planterElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Ivy Level 5",
                effectDisplay:
                    "The lesser of auto planting and cutting amounts is increased to match the greater"
            },
            visibility: () => showIf(planterElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => planterElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const expanderElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Hope Level 1",
                effectDisplay: "Forest size grows by trees planted per second raised to ^0.99"
            },
            shouldEarn: () => expandersElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Hope Level 2",
                effectDisplay: "Hope now buys max."
            },
            visibility: () => showIf(expanderElfMilestones[0].earned.value),
            shouldEarn: () => expandersElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Hope Level 3",
                effectDisplay:
                    "The workshop can be expanded past 100%, but costs scale faster. It also buys max now."
            },
            visibility: () => showIf(expanderElfMilestones[1].earned.value),
            shouldEarn: () => expandersElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Hope Level 4",
                effectDisplay: "Unlock an elf that autobuys mining drills."
            },
            visibility: () => showIf(expanderElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => expandersElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Hope Level 5",
                effectDisplay: "Unlock an elf that autobuys metal buyables."
            },
            visibility: () => showIf(expanderElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => expandersElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const heatedCutterElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Jack Level 1",
                effectDisplay: "Heated cutters are less expensive."
            },
            shouldEarn: () => heatedCutterElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Jack Level 2",
                effectDisplay: "Coal gain is raised to the ^1.05"
            },
            visibility: () => showIf(heatedCutterElfMilestones[0].earned.value),
            shouldEarn: () => heatedCutterElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Jack Level 3",
                effectDisplay: "Jack now buys max."
            },
            visibility: () => showIf(heatedCutterElfMilestones[1].earned.value),
            shouldEarn: () => heatedCutterElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Jack Level 4",
                effectDisplay: "Oil gain is multiplied based on total elf levels."
            },
            visibility: () =>
                showIf(heatedCutterElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedCutterElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Jack Level 5",
                effectDisplay: "Unlock an elf that autobuys oil buyables."
            },
            visibility: () =>
                showIf(heatedCutterElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedCutterElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const heatedPlanterElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Mary Level 1",
                effectDisplay: `"Tillamook Burn Country" affects "Heated Planters" twice.`
            },
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Mary Level 2",
                effectDisplay: "Double automatic tree planting speed"
            },
            visibility: () => showIf(heatedPlanterElfMilestones[0].earned.value),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Mary Level 3",
                effectDisplay: "Mary now buys max."
            },
            visibility: () => showIf(heatedPlanterElfMilestones[1].earned.value),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Mary Level 4",
                effectDisplay: "Metal gain is raised to the 1.1."
            },
            visibility: () =>
                showIf(heatedPlanterElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Mary Level 5",
                effectDisplay: jsx(() => (
                    <>
                        Auto smelting speed is multiplied by <Sqrt>total XP/1000</Sqrt>.
                    </>
                ))
            },
            visibility: () =>
                showIf(heatedPlanterElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const fertilizerElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Noel Level 1",
                effectDisplay: jsx(() => (
                    <>
                        Log gain is multiplied by <Sqrt>total elf levels</Sqrt>.
                    </>
                ))
            },
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Noel Level 2",
                effectDisplay: `"The Garden Tree's Handbook" affects "Fertilized Soil" twice`
            },
            visibility: () => showIf(fertilizerElfMilestones[0].earned.value),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Noel Level 3",
                effectDisplay: "Divide the mining drill cost by ln(Total logs + e)"
            },
            visibility: () => showIf(fertilizerElfMilestones[1].earned.value),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Noel Level 4",
                effectDisplay: jsx(() => (
                    <>
                        Reduce oil refinery cost by (Plastic amount)<sup>2</sup>
                    </>
                ))
            },
            visibility: () =>
                showIf(fertilizerElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Noel Level 5",
                effectDisplay: "Unlock an elf that autobuys drills and extractors"
            },
            visibility: () =>
                showIf(fertilizerElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => heatedPlanterElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const smallfireElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Joy Level 1",
                effectDisplay: "Multiply small fire efficiency by 5."
            },
            shouldEarn: () => smallfireElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Joy Level 2",
                effectDisplay: "Raise ash gain to the 1.1"
            },
            visibility: () => showIf(smallfireElfMilestones[0].earned.value),
            shouldEarn: () => smallfireElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Joy Level 3",
                effectDisplay: "Mining drill is 2x more powerful"
            },
            visibility: () => showIf(smallfireElfMilestones[1].earned.value),
            shouldEarn: () => smallfireElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Joy Level 4",
                effectDisplay: "Metal gain is boosted by heavy drills"
            },
            visibility: () =>
                showIf(smallfireElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => smallfireElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Joy Level 5",
                effectDisplay: "Raise Industrial Crucible's effect to the 1.1"
            },
            visibility: () =>
                showIf(smallfireElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => smallfireElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const bonfireElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Faith Level 1",
                effectDisplay: "Multiply bonfire efficiency by 5."
            },
            shouldEarn: () => bonfireElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Faith Level 2",
                effectDisplay: "Raise ash gain to the 1.1"
            },
            visibility: () => showIf(bonfireElfMilestones[0].earned.value),
            shouldEarn: () => bonfireElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Faith Level 3",
                effectDisplay: "Mining drill is 2x more powerful"
            },
            visibility: () => showIf(bonfireElfMilestones[1].earned.value),
            shouldEarn: () => bonfireElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Faith Level 4",
                effectDisplay: "Oil gain is boosted by heavy drill drills"
            },
            visibility: () => showIf(bonfireElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => bonfireElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Faith Level 5",
                effectDisplay: "Raise Industrial Crucible's effect to the 1.1"
            },
            visibility: () => showIf(bonfireElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => bonfireElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const kilnElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Snowball Level 1",
                effectDisplay: "Multiply kiln efficiency by 5."
            },
            shouldEarn: () => kilnElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Snowball Level 2",
                effectDisplay: "Raise ash gain to the 1.1"
            },
            visibility: () => showIf(kilnElfMilestones[0].earned.value),
            shouldEarn: () => kilnElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Snowball Level 3",
                effectDisplay: "Mining drill is 2x more powerful"
            },
            visibility: () => showIf(kilnElfMilestones[1].earned.value),
            shouldEarn: () => kilnElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Snowball Level 4",
                effectDisplay: "Plastic gain is boosted by heavy extractors"
            },
            visibility: () => showIf(kilnElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => kilnElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Snowball Level 5",
                effectDisplay: "Raise Industrial Crucible's effect to the 1.1"
            },
            visibility: () => showIf(kilnElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => kilnElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const paperElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Star Level 1",
                effectDisplay: "Book cost is divided by total books bought."
            },
            shouldEarn: () => paperElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Star Level 2",
                effectDisplay: "Pulp requires 10x less ash"
            },
            visibility: () => showIf(paperElfMilestones[0].earned.value),
            shouldEarn: () => paperElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Star Level 3",
                effectDisplay: "Book cost scaling 5x -> 4x"
            },
            visibility: () => showIf(paperElfMilestones[1].earned.value),
            shouldEarn: () => paperElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Star Level 4",
                effectDisplay: jsx(() => (
                    <>
                        Multiply XP requirements by 0.95<sup>(total books)</sup>
                    </>
                ))
            },
            visibility: () => showIf(paperElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => paperElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Star Level 5",
                effectDisplay: "Gain 5 free books for all elves that are at level 5 or above."
            },
            visibility: () => showIf(paperElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => paperElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const boxElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Bell Level 1",
                effectDisplay: jsx(() => (
                    <>
                        Every box buyable adds <Sqrt>level</Sqrt> levels to same-row box buyables.
                    </>
                ))
            },
            shouldEarn: () => boxElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Bell Level 2",
                effectDisplay: "Box gain ^1.1"
            },
            visibility: () => showIf(boxElfMilestones[0].earned.value),
            shouldEarn: () => boxElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Bell Level 3",
                effectDisplay: "All box buyables scaling bases -1"
            },
            visibility: () => showIf(boxElfMilestones[1].earned.value),
            shouldEarn: () => boxElfTraining.level.value >= 3
        })),
        createMilestone(() => ({
            display: {
                requirement: "Bell Level 4",
                effectDisplay: "Unlock a second row of box buyables"
            },
            visibility: () => showIf(boxElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => boxElfTraining.level.value >= 4
        })),
        createMilestone(() => ({
            display: {
                requirement: "Bell Level 5",
                effectDisplay: "Unlock another row of box upgrades"
            },
            visibility: () => showIf(boxElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => boxElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;
    const clothElfMilestones = [
        createMilestone(() => ({
            display: {
                requirement: "Gingersnap Level 1",
                effectDisplay: "Multiply all primary dye colors by ln(cloth + e)."
            },
            shouldEarn: () => clothElfTraining.level.value >= 1
        })),
        createMilestone(() => ({
            display: {
                requirement: "Gingersnap Level 2",
                effectDisplay: jsx(() => (
                    <>
                        Multiply all cloth actions' effectiveness by log<sub>10</sub>(dye sum + 10)
                    </>
                ))
            },
            visibility: () => showIf(clothElfMilestones[0].earned.value),
            shouldEarn: () => clothElfTraining.level.value >= 2
        })),
        createMilestone(() => ({
            display: {
                requirement: "Gingersnap Level 3",
                effectDisplay: "Double all dye colors and cloth actions, but reset all dyes."
            },
            visibility: () => showIf(clothElfMilestones[1].earned.value),
            shouldEarn: () => clothElfTraining.level.value >= 3,
            onComplete() {
                (["red", "yellow", "blue", "orange", "green", "purple"] as const).forEach(
                    dyeColor => {
                        dyes.dyes[dyeColor].amount.value = 0;
                        dyes.dyes[dyeColor].buyable.amount.value = 0;
                    }
                );
            }
        })),
        createMilestone(() => ({
            display: {
                requirement: "Gingersnap Level 4",
                effectDisplay: jsx(() => (
                    <>
                        Multiply ALL dye gain by{" "}
                        <Fraction>
                            <div>
                                <Sqrt>classrooms</Sqrt>
                            </div>
                            <div>2</div>
                        </Fraction>
                        +1, but reset all dyes.
                    </>
                ))
            },
            visibility: () => showIf(clothElfMilestones[2].earned.value && main.day.value >= 13),
            shouldEarn: () => clothElfTraining.level.value >= 4,
            onComplete() {
                (["red", "yellow", "blue", "orange", "green", "purple"] as const).forEach(
                    dyeColor => {
                        dyes.dyes[dyeColor].amount.value = 0;
                        dyes.dyes[dyeColor].buyable.amount.value = 0;
                    }
                );
            }
        })),
        createMilestone(() => ({
            display: {
                requirement: "Gingersnap Level 5",
                effectDisplay: "Well depth divides metal machine costs"
            },
            visibility: () => showIf(clothElfMilestones[3].earned.value && main.day.value >= 13),
            shouldEarn: () => clothElfTraining.level.value >= 5
        }))
    ] as Array<GenericMilestone>;

    // ------------------------------------------------------------------------------- Milestone display

    const currentShown = persistent<string>("Holly");
    const currentElfDisplay = jsx(() => {
        const elf = Object.values(elfTraining).find(
            training => training.name === currentShown.value
        );
        if (elf == null) {
            console.warn("This should not happen.", currentShown.value);
            return "";
        }
        return (
            <>
                {currentShown.value}'s milestones: {elf.displayMilestone()}
            </>
        );
    });
    const cutterElfTraining = createElfTraining(elves.elves.cuttersElf, cutterElfMilestones);
    const planterElfTraining = createElfTraining(elves.elves.plantersElf, planterElfMilestones);
    const expandersElfTraining = createElfTraining(elves.elves.expandersElf, expanderElfMilestones);
    const treeElfTraining = [cutterElfTraining, planterElfTraining, expandersElfTraining];

    const heatedCutterElfTraining = createElfTraining(
        elves.elves.heatedCuttersElf,
        heatedCutterElfMilestones
    );
    const heatedPlanterElfTraining = createElfTraining(
        elves.elves.heatedPlantersElf,
        heatedPlanterElfMilestones
    );
    const fertilizerElfTraining = createElfTraining(
        elves.elves.fertilizerElf,
        fertilizerElfMilestones
    );
    const coalElfTraining = [
        heatedCutterElfTraining,
        heatedPlanterElfTraining,
        fertilizerElfTraining
    ];

    const smallfireElfTraining = createElfTraining(
        elves.elves.smallFireElf,
        smallfireElfMilestones
    );
    const bonfireElfTraining = createElfTraining(elves.elves.bonfireElf, bonfireElfMilestones);
    const kilnElfTraining = createElfTraining(elves.elves.kilnElf, kilnElfMilestones);
    const fireElfTraining = [smallfireElfTraining, bonfireElfTraining, kilnElfTraining];

    const paperElfTraining = createElfTraining(elves.elves.paperElf, paperElfMilestones);
    const boxElfTraining = createElfTraining(elves.elves.boxElf, boxElfMilestones);
    const clothElfTraining = createElfTraining(elves.elves.clothElf, clothElfMilestones);
    const plasticElfTraining = [paperElfTraining, boxElfTraining, clothElfTraining];

    const elfTraining = {
        cutterElfTraining,
        planterElfTraining,
        expandersElfTraining,
        heatedCutterElfTraining,
        heatedPlanterElfTraining,
        fertilizerElfTraining,
        smallfireElfTraining,
        bonfireElfTraining,
        kilnElfTraining,
        paperElfTraining,
        boxElfTraining,
        clothElfTraining
    };
    const day12Elves = [
        cutterElfTraining,
        planterElfTraining,
        expandersElfTraining,
        heatedCutterElfTraining,
        heatedPlanterElfTraining,
        fertilizerElfTraining,
        smallfireElfTraining,
        bonfireElfTraining,
        kilnElfTraining,
        paperElfTraining,
        boxElfTraining,
        clothElfTraining
    ];
    const day13Elves = [
        cutterElfTraining,
        planterElfTraining,
        expandersElfTraining,
        heatedCutterElfTraining,
        heatedPlanterElfTraining,
        fertilizerElfTraining,
        smallfireElfTraining,
        bonfireElfTraining,
        kilnElfTraining,
        paperElfTraining,
        boxElfTraining,
        clothElfTraining
    ];

    // ------------------------------------------------------------------------------- Update

    globalBus.on("update", diff => {
        if (main.day.value < day) return;

        for (const elf of Object.values(elfTraining)) {
            const times = Math.floor(elf.amountOfTimesDone.value);
            if (times >= 1) {
                elf.amountOfTimesDone.value -= times;
                if (Decimal.lt(elf.level.value, schools.amount.value))
                    elf.exp.value = Decimal.mul(elf.elfXPGainComputed.value, times).add(
                        elf.exp.value
                    );
            }
        }
        focusTime.value = Decimal.sub(focusTime.value, diff).max(0)
        focusCooldown.value = Decimal.sub(focusCooldown.value, diff).max(0)
        if (Decimal.eq(focusTime.value, 0)) {
            focusMulti.value = Decimal.pow(
                focusMaxMulti.value,
                1 - Math.abs(Math.sin((Date.now() / 1000) * 2))
            );
        }
    });

    // ------------------------------------------------------------------------------- Focus

    const focusMulti = persistent<DecimalSource>(1);
    const focusTargets = persistent<Record<string, boolean>>({});
    const focusCooldown = persistent<DecimalSource>(0);
    const focusTime = persistent<DecimalSource>(0);

    const focusMaxMultiModifiers = createSequentialModifier(() => [
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: "Focus Upgrade 1",
            enabled: focusUpgrade1.bought
        }))
    ]);
    const maximumElvesModifier = createSequentialModifier(() => [
        createAdditiveModifier(() => ({
            addend: 1,
            description: "Focus Upgrade 2",
            enabled: focusUpgrade2.bought
        }))
    ]);

    const cooldownModifiers = createSequentialModifier(() => [
        createAdditiveModifier(() => ({
            addend: -5,
            description: "Focus Upgrade 3",
            enabled: focusUpgrade3.bought
        }))
    ]);

    const focusMaxMulti = computed(() => focusMaxMultiModifiers.apply(10));
    const maximumElves = computed(() => maximumElvesModifier.apply(3));
    const cooldown = computed(() => Number(cooldownModifiers.apply(15)));

    const focusMeter = createBar(() => ({
        direction: Direction.Right,
        width: 566,
        height: 25,
        style: `border-radius: 4px 4px 0 0`,
        borderStyle: `border-radius: 4px 4px 0 0`,
        fillStyle: `background: ${color}; transition: none`,
        progress: () =>
            Decimal.sub(focusMulti.value, 1).div(Decimal.sub(focusMaxMulti.value, 1)).toNumber(),
        display: jsx(() => <>{format(focusMulti.value)}x</>)
    })) as GenericBar;

    const focusButton = createClickable(() => ({
        display: {
            title: "Focus",
            description: jsx(() => (
                <>
                    Motivate elves to focus, multiplying 3 random elves' XP gain by up to{" "}
                    {format(focusMaxMulti.value)}x, equal to the focus bars' effect.
                    {Decimal.gte(focusCooldown.value, 0) ? (
                        <>
                            <br />
                            Reroll cooldown: {formatTime(focusCooldown.value)}
                        </>
                    ) : (
                        ""
                    )}
                </>
            ))
        },
        style: {
            width: "300px"
        },
        canClick: () => Decimal.eq(focusCooldown.value, 0),
        onClick() {
            focusCooldown.value = cooldown.value;
            focusTime.value = 10;

            // better choice? this has to be a number
            rerollFocusTargets(12, maximumElves.value);
        }
    }));

    function rerollFocusTargets(range: number, count: DecimalSource) {
        let x = 0;
        focusTargets.value = {};
        const newCount = Decimal.min(count, range)
        while (newCount.gte(x)) {
            const roll = Object.values(elfTraining)[Math.floor(Math.random() * range)]?.name ?? "";
            if (!focusTargets.value[roll]) {
                focusTargets.value[roll] = true;
                x++;
            }
        }
    }
    const focusUpgrade1 = createUpgrade(() => ({
        display: {
            title: "Focus Booster",
            description: "Multiplies the maximum experience multiplier from focus by 2"
        },
        resource: trees.logs,
        cost: 1e30
    }));
    const focusUpgrade2 = createUpgrade(() => ({
        display: {
            title: "Focus Buffer",
            description: "Increase elves affected by focus by 1"
        },
        resource: trees.logs,
        cost: 1e40
    }));
    const focusUpgrade3 = createUpgrade(() => ({
        display: {
            title: "Focus Upgrader",
            description: "Focus can now be rerolled every 10 seconds"
        },
        resource: trees.logs,
        cost: 1e50
    }));
    const upgrades = { focusUpgrade1, focusUpgrade2, focusUpgrade3 };
    // ------------------------------------------------------------------------------- Schools

    const schoolCost = computed(() => {
        const schoolFactor = Decimal.pow(10, schools.amount.value);
        return {
            wood: schoolFactor.mul(1e21),
            coal: schoolFactor.mul(1e32),
            paper: schoolFactor.mul(1e18),
            boxes: schoolFactor.mul(1e13),
            metalIngots: schoolFactor.mul(1e12),
            cloth: schoolFactor.mul(1e4),
            plastic: schoolFactor.mul(1e6),
            dye: Decimal.add(schools.amount.value, 1).mul(10000)
        };
    });

    const schools = createBuyable(() => ({
        display: jsx(() => (
            <>
                <h3>Build a School</h3>
                <div>
                    You gotta start somewhere, right? Each school increases the maximum level for
                    elves by 1, up to 5.
                </div>
                <div>
                    You have {formatWhole(schools.amount.value)} schools, which are currently
                    letting elves learn up to level {formatWhole(schools.amount.value)}.
                </div>
                <div>
                    Costs {format(schoolCost.value.wood)} logs, {format(schoolCost.value.coal)}{" "}
                    coal, {format(schoolCost.value.paper)} paper, {format(schoolCost.value.boxes)}{" "}
                    boxes, {format(schoolCost.value.metalIngots)} metal ingots,{" "}
                    {format(schoolCost.value.cloth)} cloth, {format(schoolCost.value.plastic)}{" "}
                    plastic, and requires {format(schoolCost.value.dye)} of red, yellow, and blue
                    dye
                </div>
            </>
        )),
        canPurchase(): boolean {
            return (
                schoolCost.value.wood.lte(trees.logs.value) &&
                schoolCost.value.coal.lte(coal.coal.value) &&
                schoolCost.value.paper.lte(paper.paper.value) &&
                schoolCost.value.boxes.lte(boxes.boxes.value) &&
                schoolCost.value.metalIngots.lte(metal.metal.value) &&
                schoolCost.value.cloth.lte(cloth.cloth.value) &&
                schoolCost.value.plastic.lte(plastic.plastic.value) &&
                schoolCost.value.dye.lte(dyes.dyes.blue.amount.value) &&
                schoolCost.value.dye.lte(dyes.dyes.red.amount.value) &&
                schoolCost.value.dye.lte(dyes.dyes.yellow.amount.value)
            );
        },
        onPurchase() {
            trees.logs.value = Decimal.sub(trees.logs.value, schoolCost.value.wood);
            coal.coal.value = Decimal.sub(coal.coal.value, schoolCost.value.coal);
            paper.paper.value = Decimal.sub(paper.paper.value, schoolCost.value.paper);
            boxes.boxes.value = Decimal.sub(boxes.boxes.value, schoolCost.value.boxes);
            metal.metal.value = Decimal.sub(metal.metal.value, schoolCost.value.metalIngots);
            cloth.cloth.value = Decimal.sub(cloth.cloth.value, schoolCost.value.cloth);
            plastic.plastic.value = Decimal.sub(plastic.plastic.value, schoolCost.value.plastic);
            this.amount.value = Decimal.add(this.amount.value, 1);
        },
        purchaseLimit: 5,
        visibility: computed(() => showIf(teaching.bought.value)),
        style: "width: 600px"
    }));

    const classroomCost = computed(() => {
        const classroomFactor = Decimal.add(schools.amount.value, 1).pow(1.5);
        return {
            wood: classroomFactor.mul(1e21),
            paper: classroomFactor.mul(1e18),
            boxes: classroomFactor.mul(1e13),
            metalIngots: classroomFactor.mul(1e12)
        };
    });

    const classroomEffect = computed(() => {
        return Decimal.add(classrooms.amount.value, 1).sqrt();
    });

    const classrooms = createBuyable(() => ({
        display: jsx(() => (
            <>
                <h3>Build a Classroom</h3>
                <div>
                    Hopefully it makes the school a bit less boring. Multiplies elves' XP gain by{" "}
                    <Sqrt>Classrooms + 1</Sqrt>.
                </div>
                <div>
                    You have {formatWhole(classrooms.amount.value)} classrooms, which are currently
                    multiplying elves' XP gain by {format(classroomEffect.value)}
                </div>
                <div>
                    Costs {format(classroomCost.value.wood)} logs,{format(classroomCost.value.paper)}{" "}
                    paper, {format(classroomCost.value.boxes)} boxes,{" "}
                    {format(classroomCost.value.metalIngots)} metal ingots
                </div>
            </>
        )),
        canPurchase(): boolean {
            return (
                classroomCost.value.wood.lte(trees.logs.value) &&
                classroomCost.value.paper.lte(paper.paper.value) &&
                classroomCost.value.boxes.lte(boxes.boxes.value) &&
                classroomCost.value.metalIngots.lte(metal.metal.value)
            );
        },
        onPurchase() {
            trees.logs.value = Decimal.sub(trees.logs.value, classroomCost.value.wood);
            paper.paper.value = Decimal.sub(paper.paper.value, classroomCost.value.paper);
            boxes.boxes.value = Decimal.sub(boxes.boxes.value, classroomCost.value.boxes);
            metal.metal.value = Decimal.sub(metal.metal.value, classroomCost.value.metalIngots);
            this.amount.value = Decimal.add(this.amount.value, 1);
        },
        visibility: computed(() => showIf(classroomUpgrade.bought.value)),
        style: "width: 600px"
    }));

    // ------------------------------------------------------------------------------- Modifiers

    const [generalTab, generalTabCollapsed] = createCollapsibleModifierSections(() => [
        {
            title: "Elves affected by Focus",
            modifier: maximumElvesModifier,
            base: 3
        },
        {
            title: "Maximum Focus Effect",
            modifier: focusMaxMultiModifiers,
            base: 10
        },
        {
            title: "Focus Cooldown",
            modifier: cooldownModifiers,
            unit: " secs",
            base: 15
        },
        {
            title: "Global XP Gain",
            modifier: globalXPModifier,
            unit: " XP"
        },
        {
            title: "Holly XP Gain per Action",
            modifier: cutterElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Ivy XP Gain per Action",
            modifier: planterElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Hope XP Gain per Action",
            modifier: expandersElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Jack XP Gain per Action",
            modifier: heatedCutterElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Mary XP Gain per Action",
            modifier: heatedPlanterElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Noel XP Gain per Action",
            modifier: fertilizerElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Joy XP Gain per Action",
            modifier: smallfireElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Faith XP Gain per Action",
            modifier: bonfireElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Snowball XP Gain per Action",
            modifier: kilnElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Star XP Gain per Action",
            modifier: paperElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Bell XP Gain per Action",
            modifier: boxElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        },
        {
            title: "Gingersnap XP Gain per Action",
            modifier: clothElfTraining.elfXPGain,
            base: 0.1,
            unit: " XP"
        }
    ]);
    const showModifiersModal = ref(false);
    const modifiersModal = jsx(() => (
        <Modal
            modelValue={showModifiersModal.value}
            onUpdate:modelValue={(value: boolean) => (showModifiersModal.value = value)}
            v-slots={{
                header: () => <h2>{name} Modifiers</h2>,
                body: generalTab
            }}
        />
    ));

    // ------------------------------------------------------------------------------- Return

    return {
        name,
        day,
        color,
        minWidth: 700,

        elfTraining,
        totalElfLevels,
        currentShown,
        generalTabCollapsed,

        teaching,
        schools,
        classrooms,
        classroomUpgrade,

        focusMultiplier: focusMulti,
        upgrades,
        focusTargets,
        focusCooldown,
        focusTime,

        display: jsx(() => (
            <>
                {main.day.value === day
                    ? `Get all elves to level 3.`
                    : main.day.value === advancedDay && main.days[advancedDay - 1].opened.value
                    ? `Get all elves to level 5.`
                    : `${name} Complete!`}{" "}
                -
                <button
                    class="button"
                    style="display: inline-block;"
                    onClick={() => (showModifiersModal.value = true)}
                >
                    Check Modifiers
                </button>
                {render(modifiersModal)}
                {render(dayProgress)}
                <br />
                {renderCol(schools, classrooms)} {renderGrid([teaching, classroomUpgrade])}
                {Decimal.gt(schools.amount.value, 0) ? (
                    <>
                        <br />
                        Click on an elf to see their milestones.
                        <br />
                        <br />
                        {render(focusButton)}
                        <br />
                        {renderGrid(
                            [focusMeter],
                            treeElfTraining,
                            coalElfTraining,
                            fireElfTraining,
                            plasticElfTraining
                        )}
                        <Spacer />
                        {currentElfDisplay()}
                    </>
                ) : (
                    ""
                )}
            </>
        ))
    };
});

export default layer;
