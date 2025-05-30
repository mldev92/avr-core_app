/**
 * index.js
 * This file is the main entrypoint for the application.
 * @author  Giuseppe Careri
 * @see https://www.gcareri.com
 */
const express = require("express");
const Ami = require("asterisk-manager");
const { extractUUID, findCallByUUID } = require("./utils");

require("dotenv").config();

const app = express();

app.use(express.json());

let calls = {};

const ami = new Ami(
  process.env.AMI_PORT || "5038",
  process.env.AMI_HOST || "host.docker.internal",
  process.env.AMI_USERNAME || "avr",
  process.env.AMI_PASSWORD,
  true
);
ami.keepConnected();

// dialplan
ami.on("newexten", (event) => {
  if (event.application && event.application.toLowerCase() === "audiosocket") {
    calls[event.linkedid] = {
      uuid: extractUUID(event.appdata),
      channel: event.channel,
    };
  }
});

// call
ami.on("hangup", (event) => {
  if (calls[event.linkedid]) {
    delete calls[event.linkedid];
  }
});

/**
 * Hangup a call
 * @param {Object} req - The request object
 * @param {string} req.body.uuid - The UUID of the call to hangup
 * @param {Object} res - The response object
 * @returns {Object} The response object
 */
const handleHangup = async (req, res) => {
  const { uuid } = req.body;

  try {
    console.log(`Calling ami hangup action uuid: ${uuid}`);
    const call = findCallByUUID(calls, uuid);
    if (call) {
      console.log("Call found:", call);
      const action = await ami.action({
        action: "Hangup",
        channel: call.channel,
      });
      res
        .status(200)
        .json({
          message: `Call with UUID ${uuid} hangup with action: ${action}`,
        });
    } else {
      res.status(404).json({ message: `Call with UUID ${uuid} not found` });
    }
  } catch (error) {
    console.log("Error calling Ami Hangup Action:", error.message);
    res.status(500).json({ message: "Error communicating with Asterisk" });
  }
};

/**
 * Transfer a call
 * @param {Object} req - The request object
 * @param {string} req.body.uuid - The UUID of the call to transfer
 * @param {string} req.body.exten - The extension to transfer to
 * @param {string} req.body.context - The context to transfer to
 * @param {string} req.body.priority - The priority to transfer to
 * @param {Object} res - The response object
 * @returns {Object} The response object
 */
const handleTransfer = async (req, res) => {
  const { uuid, exten, context, priority } = req.body;

  try {
    console.log(
      `Calling ami redirect action to: ${context},${exten},${priority} with uuid: ${uuid}`
    );
    const call = findCallByUUID(calls, uuid);
    if (call) {
      console.log("Call found:", call);
      const action = await ami.action({
        action: "Redirect",
        channel: call.channel,
        context,
        exten,
        priority,
      });
      res
        .status(200)
        .json({
          message: `Call with UUID ${uuid} redirect with action: ${action}`,
        });
    } else {
      res.status(404).json({ message: `Call with UUID ${uuid} not found` });
    }
  } catch (error) {
    console.log("Error calling Ami Redirect Action:", error.message);
    res.status(500).json({ message: "Error communicating with Asterisk" });
  }
};

/**
 * Originate a call
 * @param {Object} req - The request object
 * @param {string} req.body.uuid - The UUID of the call to originate
 * @param {Object} res - The response object
 * @returns {Object} The response object
 */
const handleOriginate = async (req, res) => {
  const { callerid, channel, exten, context, priority } = req.body;

  try {
    console.log("Calling ami originate action");
    const action = await ami.action({
      action: "Originate",
      channel,
      exten,
      context: context || "demo",
      priority: priority || 1,
      callerid: callerid || "Agent Voice Response <avr>",
    });
    res.status(200).json({ message: `Call originate with action: ${action}` });
  } catch (error) {
    console.log("Error calling Ami Originate Action:", error.message);
    res.status(500).json({ message: "Error communicating with Asterisk" });
  }
};

app.post("/hangup", handleHangup);
app.post("/transfer", handleTransfer);
app.post("/originate", handleOriginate);

const port = process.env.PORT || 6006;
app.listen(port, () => {
  console.log(`Asterisk Manager Interface listening on port ${port}`);
});
