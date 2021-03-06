/*
  Copyright 2020 David Whiting

  This work is licensed under a Creative Commons Attribution 4.0 International License
  https://creativecommons.org/licenses/by/4.0/
*/

import { Visualiser } from "./visualiser.js";
import { MonoSynth, Kick, FeedbackDelay, Panner, Hat } from "./devices.js";

const startButton = document.getElementById("startButton");

/** Scale definitions in semitones-above-root. Only minPent made it into the final work, but fun to experiment */
const SCALES = {
    majPent: [0, 2, 4, 7, 9],
    maj: [0, 2, 4, 5, 7, 9, 11],
    minPent: [0, 2, 3, 7, 10],
    minSix: [0, 2, 3, 5, 7, 10]
};

/** For displaying the current key */
const NOTE_NAMES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

/** Frequency multiplication factor per semitone for equal temperament tuning */
const SEMITONE_FACTOR = Math.pow(2, 1.0 / 12);

/** Choose a random element from array. Set power > 1 to left-bias selection */
function choose(array, power = 1) {
    return array[rndInt(array.length, power)]
}

/** Choose a random integer 0 <= v < max. Set power > 1 to low-bias selection */
function rndInt(max, power = 1) {
    return Math.floor(Math.pow(Math.random(), power) * max);
}

/** Create a new pattern which can be mutated in a variety of ways */
function Pattern(scale) {
    const seq=[];

    // Random note from 2-octave range
    function randomNote() {
        return choose(scale) + choose([0,12]);
    }

    // Truncate or extend sequence to new length. Fill any empty slots with random notes
    function reshapeSequence() {
        const seqLength = choose([3,4, 5,8,12]);
        seq.length = seqLength;
        for (let i =0 ; i < seqLength; i++) {
            if (seq[i] === undefined) {
                seq[i] = randomNote();
            }
        }
    }

    // swap position of 2 elements in sequence
    function swap() {
        let a = rndInt(seq.length);
        let b = rndInt(seq.length);
        let t = seq[a];
        seq[a] = seq[b];
        seq[b] = t;
    }

    // randomize single element in sequence
    function randomizeOne() {
        let index = rndInt(seq.length);
        seq[index] = randomNote();
    }

    /** Mutate the pattern by applying one of the above transformations */
    function mutate() {
        // The strongly left-biased selection means that swaps are way more frequent than reshapes
        choose([swap, randomizeOne, reshapeSequence], 5)();
    }

    /** Retrieve the note value for a given step */
    function get(step) {
        return seq[step % seq.length];
    }

    reshapeSequence();

    return {seq, get, mutate}
}

/** A parameter that randomly wanders between the lowerBound and upperBound, using 2nd order random variation.
 *
 * @param lowerBound below this correction will be applied upwards
 * @param upperBound above this correction will be applied downwards
 * @param drift amount of random variation in velocity
 * @param correction how much correction is applied when param is out of bounds
 */
function WanderingParameter(lowerBound, upperBound, drift, correction) {
    let value = (lowerBound + upperBound) / 2;
    let direction = Math.random() * 20 * drift - 10 * drift;

    function moveAndGet() {
        value += direction;
        direction *= 0.95;
        if (value < lowerBound) {
            direction += correction;
        }
        if (value > upperBound) {
            direction -= correction;
        }

        direction += choose([drift, -drift]);
        return value;
    }

    return {moveAndGet: moveAndGet, value: () => value};
}

function start() {

    const audio = new (window.AudioContext || window.webkitAudioContext)();

    const bpm = 111;
    const secondsPerBeat = 60 / bpm;
    const secondsPer16th = secondsPerBeat / 4;

    let mainOut = audio.destination;

    let kickEnabled = false;
    let hatEnabled = false;
    let mondrianEnabled = false;

    window.addEventListener("keypress", function(k) {
        if (k.key === "k") kickEnabled = !kickEnabled;
        if (k.key === "h") hatEnabled = !hatEnabled;
        if (k.key === "m") mondrianEnabled = !mondrianEnabled;
    });

    let baseKey = rndInt(12);

    function createPart(baseAPitch = 110, scale, wave="sawtooth", pan = 0) {
        const monoSynth = new MonoSynth(audio, wave);
        const delay = new FeedbackDelay(audio, secondsPer16th * 3 + Math.random() * 0.02 - 0.01, 0.5);

        let panner = new Panner(audio, pan);

        monoSynth.connect(panner.in);
        monoSynth.connect(delay.in);

        delay.out.connect(panner.in);
        panner.out.connect(mainOut);

        function keyToFreq(semisAboveBase) {
            return Math.pow(SEMITONE_FACTOR, semisAboveBase + baseKey) * baseAPitch;
        }

        let stepNumber = 0;
        const pattern = Pattern(scale);

        const filterExponent = WanderingParameter(5, 9, 0.002, 0.03);
        const delayFeedback = WanderingParameter(0.1,0.9,0.0007,0.001);

        function step() {
            stepNumber++;

            const oscFreq = keyToFreq(pattern.get(stepNumber));
            const filterFreq = Math.exp(filterExponent.moveAndGet());

            monoSynth.play(oscFreq, filterFreq, 0.2);

            if (stepNumber % 4 === 0) {
                pattern.mutate();
            }

            delay.feedback.setTargetAtTime(delayFeedback.moveAndGet(), audio.currentTime, 0.04);

            return {
               step: (stepNumber % pattern.seq.length), filter: Math.floor(Math.exp(filterExponent.value())), delayFb: Math.floor(delayFeedback.value() * 100), seq: pattern.seq
            };
        }
        return {step}
    }

    const vis = Visualiser();

    const kick = new Kick(audio);
    const hat = new Hat(audio);
    kick.out.connect(mainOut);
    hat.out.connect(mainOut);

    const left = createPart(110, SCALES.minPent, "sawtooth", -0.6);
    const right = createPart(110, SCALES.minPent, "sawtooth", 0.6);
    const bass = createPart(55, [0], "sawtooth", 0);

    let stepGlobal = 0;
    function compositionStep() {
        stepGlobal++;
        if (kickEnabled && stepGlobal % 4 === 0) {
           kick.play();
        }
        if (hatEnabled) {
            hat.play(0.1 * (0.4*Math.random() + 0.3 * ((stepGlobal + 1) % 2) + 0.3 * ((stepGlobal + 1) % 3) + 0.6 * ((stepGlobal + 1) % 4)));
        }
        if (stepGlobal % 128 === 0) {
            // Allow key moves up to 2 steps along the cycle of fifths in either direction
            baseKey = (baseKey + choose([0,7,5,10,2], 3)) % 12;
        }
        let leftOut = left.step();
        let rightOut = right.step();
        let bassOut = bass.step();
        vis.visualise(leftOut, bassOut, rightOut, NOTE_NAMES[baseKey % 12]);

        if (mondrianEnabled) {
            vis.randomRectangles();
        }
    }


    window.setInterval(() => vis.refreshFrame(), 1000 / 30);
    window.setInterval(compositionStep, 1000 * secondsPer16th);

    startButton.style.display = "none";
}

startButton.onclick = start;
