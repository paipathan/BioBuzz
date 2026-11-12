package org.firstinspires.ftc.teamcode.util;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import java.util.Arrays;
import java.util.stream.IntStream;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;

@TeleOp(name = "Servo Test")
public class ServoTest extends LinearOpMode {
    @Override
    public void runOpMode() {
        int[] controlPorts = IntStream.rangeClosed(0, 5)
                .filter(port -> port != Constants.Turret.turretServoPort1 && port != Constants.Turret.turretServoPort2)
                .toArray();
        int[] expansionPorts = IntStream.rangeClosed(0, 5).toArray();

        // Control hub entries first, then expansion hub entries
        int[] ports = new int[controlPorts.length + expansionPorts.length];
        boolean[] expansion = new boolean[ports.length];
        for (int i = 0; i < controlPorts.length; i++) ports[i] = controlPorts[i];
        for (int i = 0; i < expansionPorts.length; i++) {
            ports[controlPorts.length + i] = expansionPorts[i];
            expansion[controlPorts.length + i] = true;
        }

        NextServo[] servos = new NextServo[ports.length];
        double[] positions = new double[ports.length];
        Arrays.fill(positions, 0.5);
        boolean[] commanded = new boolean[ports.length];
        String[] errors = new String[ports.length];

        int selected = 0;
        double step = 0.05;

        boolean lastLeftBumper = false;
        boolean lastRightBumper = false;
        boolean lastY = false;
        boolean lastDpadLeft = false;
        boolean lastDpadRight = false;

        waitForStart();

        while (opModeIsActive()) {
            if (gamepad1.dpad_right && !lastDpadRight) selected = (selected + 1) % ports.length;
            if (gamepad1.dpad_left && !lastDpadLeft) selected = (selected - 1 + ports.length) % ports.length;
            lastDpadRight = gamepad1.dpad_right;
            lastDpadLeft = gamepad1.dpad_left;

            double position = positions[selected];

            if (gamepad1.x) position = 0.5;
            else if (gamepad1.b) position = 1;
            else if (gamepad1.a) position = 0;

            if (gamepad1.y && !lastY) step = step == 0.05 ? 0.005 : 0.05;

            boolean stepUp = gamepad1.right_bumper && !lastRightBumper;
            boolean stepDown = gamepad1.left_bumper && !lastLeftBumper;
            if (stepUp) position += step;
            if (stepDown) position -= step;
            lastRightBumper = gamepad1.right_bumper;
            lastLeftBumper = gamepad1.left_bumper;
            lastY = gamepad1.y;

            position = Math.max(0, Math.min(1, position));
            positions[selected] = position;

            if (gamepad1.x || gamepad1.b || gamepad1.a || stepUp || stepDown) commanded[selected] = true;

            if (commanded[selected]) {
                try {
                    if (servos[selected] == null) {
                        servos[selected] = new NextServo(expansion[selected] ? RobotController.expansionHub() : RobotController.controlHub(), ports[selected], 0.001, NextMotor.Direction.FORWARD);
                    }
                    servos[selected].setPosition(position);
                    errors[selected] = null;
                } catch (Exception e) {
                    if (e instanceof InterruptedException) Thread.currentThread().interrupt();
                    servos[selected] = null;
                    errors[selected] = e.toString();
                }
            }

            telemetry.addData("Hub", expansion[selected] ? "Expansion" : "Control");
            telemetry.addData("Servo port (dpad left/right)", ports[selected]);
            telemetry.addData("Servo position", commanded[selected] ? String.valueOf(position) : "not moved yet");
            telemetry.addData("Step (Y to toggle)", step);
            if (errors[selected] != null) {
                telemetry.addLine("Can't drive " + (expansion[selected] ? "expansion" : "control") + " port " + ports[selected] + ": " + errors[selected]);
            }
            telemetry.addLine("Not moving? Check the plug, the hub can't detect an empty port");
            telemetry.update();
        }
    }
}
