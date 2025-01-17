/**
 * @module
 * @hidden
 */
import Column from "components/layout/Column.vue";
import Row from "components/layout/Row.vue";
import Spacer from "components/layout/Spacer.vue";
import Modal from "components/Modal.vue";
import {
    changeActiveBuyables,
    createCollapsibleModifierSections,
    setUpDailyProgressTracker
} from "data/common";
import { main } from "data/projEntry";
import { createBuyable, GenericBuyable } from "features/buyable";
import { jsx, showIf } from "features/feature";
import MainDisplay from "features/resources/MainDisplay.vue";
import { createResource, Resource } from "features/resources/resource";
import { createUpgrade, GenericUpgrade } from "features/upgrades/upgrade";
import { globalBus } from "game/events";
import { BaseLayer, createLayer } from "game/layers";
import {
    createAdditiveModifier,
    createMultiplicativeModifier,
    createSequentialModifier
} from "game/modifiers";
import { noPersist, persistent } from "game/persistence";
import Decimal, { DecimalSource, format, formatWhole } from "util/bignum";
import { render, renderCol, renderRow } from "util/vue";
import { computed, ref, unref } from "vue";
import boxes from "./boxes";
import metal from "./metal";
import oil from "./oil";
import dyes from "./dyes";

const id = "plastic";
const day = 10;
const layer = createLayer(id, function (this: BaseLayer) {
    const name = "Plastic";
    const color = "#DCD9CD";

    const plastic = createResource<DecimalSource>(0, "plastic");

    const [generalTab, generalTabCollapsed] = createCollapsibleModifierSections(() => [
        {
            title: "Plastic Gain",
            modifier: plasticGain,
            base: 0
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

    const activeRefinery = persistent<DecimalSource>(0);
    const oilCost = computed(() => Decimal.times(activeRefinery.value, 100));
    const buildRefinery = createBuyable(() => ({
        resource: metal.metal,
        cost() {
            const v = new Decimal(this.amount.value);
            return Decimal.pow(1.2, v).times(1e7);
        },
        display: jsx(() => (
            <>
                <h3>Refinery</h3>
                <br />
                Refines oil into plastic pellets
                <br />
                Consumes 100 oil/s to create 1 plastic/s
                <br />
                <br />
                Currently:
                <br />-{format(oilCost.value)} oil/sec
                <br />+{format(activeRefinery.value)} plastic/sec
                <br />
                <br />
                Cost: {formatWhole(unref(buildRefinery.cost!))}{" "}
                {buildRefinery.resource!.displayName}
            </>
        )),
        onPurchase() {
            activeRefinery.value = Decimal.add(activeRefinery.value, 1);
        },
        style: {
            width: "300px"
        }
    })) as GenericBuyable & { resource: Resource };
    const {
        min: minRefinery,
        max: maxRefinery,
        add: addRefinery,
        remove: removeRefinery
    } = changeActiveBuyables({
        buyable: buildRefinery,
        active: activeRefinery,
        style: { minHeight: "20px", width: "40px", color: "var(--feature-foreground)" }
    });

    const upgradeCost = computed(() =>
        Decimal.pow(
            5,
            Decimal.add(
                [...Object.values(upgrades), ...Object.values(elfUpgrades)].filter(
                    upg => upg.bought.value
                ).length,
                2
            )
        )
    );
    const paperTools = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        display: () => ({
            title: "Plastic Scissors",
            description: "Unlock paper upgrades",
            showCost: !paperTools.bought.value
        })
    })) as GenericUpgrade;
    const boxTools = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        display: () => ({
            title: "Plastic Level",
            description: "Unlock box upgrades",
            showCost: !boxTools.bought.value
        })
    })) as GenericUpgrade;
    const clothTools = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        display: () => ({
            title: "Plastic Cane",
            description: "Unlock cloth upgrades",
            showCost: !clothTools.bought.value
        })
    })) as GenericUpgrade;
    const upgrades = { paperTools, boxTools, clothTools };

    const paperElf = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        visibility: () => showIf(paperTools.bought.value),
        display: () => ({
            title: "Paper Elf Recruitment",
            description: "Double plastic gain and unlock a new elf for training",
            showCost: !paperElf.bought.value
        })
    })) as GenericUpgrade;
    const boxElf = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        visibility: () => showIf(boxTools.bought.value),
        display: () => ({
            title: "Box Elf Recruitment",
            description: "Double plastic gain and unlock a new elf for training",
            showCost: !boxElf.bought.value
        })
    })) as GenericUpgrade;
    const clothElf = createUpgrade(() => ({
        resource: noPersist(plastic),
        cost: upgradeCost,
        visibility: () => showIf(clothTools.bought.value),
        display: () => ({
            title: "Cloth Elf Recruitment",
            description: "Double plastic gain and unlock a new elf for training",
            showCost: !clothElf.bought.value
        })
    })) as GenericUpgrade;
    const elfUpgrades = { paperElf, boxElf, clothElf };

    const passivePaper = createBuyable(() => ({
        resource: noPersist(plastic),
        cost() {
            const amount = this.amount.value;
            return Decimal.pow(1.3, amount).times(100);
        },
        visibility: () => showIf(paperElf.bought.value),
        display: {
            title: "Plastic Printing Press",
            description: "Gain +1% of your paper gain per second",
            effectDisplay: jsx(() => <>{formatWhole(passivePaper.amount.value)}%</>),
            showAmount: false
        }
    })) as GenericBuyable;
    const passiveBoxes = createBuyable(() => ({
        resource: noPersist(plastic),
        cost() {
            const amount = this.amount.value;
            return Decimal.pow(1.3, amount).times(100);
        },
        visibility: () => showIf(boxElf.bought.value),
        display: {
            title: "Plastic Box Folder",
            description: "Gain +1% of your box gain per second",
            effectDisplay: jsx(() => <>{formatWhole(passiveBoxes.amount.value)}%</>),
            showAmount: false
        }
    })) as GenericBuyable;
    const clothGains = createBuyable(() => ({
        resource: noPersist(plastic),
        cost() {
            const amount = this.amount.value;
            return Decimal.pow(1.3, amount).times(100);
        },
        visibility: () => showIf(clothElf.bought.value),
        display: {
            title: "Plastic Shepherd",
            description: "All cloth actions are +10% more efficient",
            effectDisplay: jsx(() => (
                <>{formatWhole(Decimal.times(clothGains.amount.value, 10))}%</>
            )),
            showAmount: false
        }
    })) as GenericBuyable;
    const buyables = { passivePaper, passiveBoxes, clothGains };

    const plasticGain = createSequentialModifier(() => [
        createAdditiveModifier(() => ({
            addend: activeRefinery,
            description: "Oil Refinery",
            enabled: () => Decimal.gt(activeRefinery.value, 0)
        })),
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: "Paper Elf Recruitment",
            enabled: paperElf.bought
        })),
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: "Box Elf Recruitment",
            enabled: boxElf.bought
        })),
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: "Cloth Elf Recruitment",
            enabled: clothElf.bought
        })),
        createMultiplicativeModifier(() => ({
            multiplier: 2,
            description: "Carry plastic in boxes",
            enabled: boxes.row2Upgrades.plasticUpgrade.bought
        })),
        createMultiplicativeModifier(() => ({
            multiplier: () => oil.oilEffectiveness.value,
            description: "Effectiveness",
            enabled: () => Decimal.lt(oil.oilEffectiveness.value, 1)
        })),
        createMultiplicativeModifier(() => ({
            multiplier: dyes.boosts.yellow1,
            description: "Yellow Dye Boost 1",
            enabled: () => Decimal.gte(dyes.dyes.yellow.amount.value, 1)
        }))
    ]);
    const computedPlasticGain = computed(() => plasticGain.apply(0));

    globalBus.on("update", diff => {
        if (Decimal.lt(main.day.value, day)) {
            return;
        }

        plastic.value = Decimal.times(diff, computedPlasticGain.value).add(plastic.value);
    });

    const { total: totalPlastic, trackerDisplay } = setUpDailyProgressTracker({
        resource: plastic,
        goal: 2.5e5,
        name,
        day,
        color,
        textColor: "var(--feature-foreground)",
        modal: {
            show: showModifiersModal,
            display: modifiersModal
        }
    });

    return {
        name,
        color,
        plastic,
        totalPlastic,
        buildRefinery,
        activeRefinery,
        oilCost,
        upgrades,
        elfUpgrades,
        buyables,
        generalTabCollapsed,
        minWidth: 700,
        display: jsx(() => (
            <>
                {render(trackerDisplay)}
                <Spacer />
                <MainDisplay resource={plastic} color={color} style="margin-bottom: 0"  effectDisplay={
                        Decimal.gt(computedPlasticGain.value, 0)
                            ? `+${format(computedPlasticGain.value)}/s`
                            : undefined
                    } />
                <Spacer />
                <Column>
                    {render(buildRefinery)}
                    <div>
                        {formatWhole(Decimal.floor(activeRefinery.value))}/
                        {formatWhole(Decimal.floor(buildRefinery.amount.value))}
                    </div>
                    {renderRow(minRefinery, removeRefinery, addRefinery, maxRefinery)}
                </Column>
                <Row>
                    {renderCol(paperTools, paperElf, passivePaper)}
                    {renderCol(boxTools, boxElf, passiveBoxes)}
                    {renderCol(clothTools, clothElf, clothGains)}
                </Row>
            </>
        ))
    };
});

export default layer;
