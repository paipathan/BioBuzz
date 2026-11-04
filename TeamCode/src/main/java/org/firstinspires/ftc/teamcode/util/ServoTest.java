package org.firstinspires.ftc.teamcode.util;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextMotor;
import dev.nextftc.hardware.actuators.NextServo;

@TeleOp(name = "Servo Test")
public class ServoTest extends LinearOpMode {
    @Override
    public void runOpMode() {
        NextServo servo = new NextServo(RobotController.controlHub(), 0, 0.001, NextMotor.Direction.FORWARD);

        double position = 0.5;
        servo.setPosition(position);

        double step = 0.05;

        boolean lastLeftBumper = false;
        boolean lastRightBumper = false;
        boolean lastY = false;

        waitForStart();

        while (opModeIsActive()) {
            if (gamepad1.x) position = 0.5;
            else if (gamepad1.b) position = 1;
            else if (gamepad1.a) position = 0;

            // step once per press, not every loop while held
            if (gamepad1.y && !lastY) step = step == 0.05 ? 0.005 : 0.05;

            if (gamepad1.right_bumper && !lastRightBumper) position += step;
            if (gamepad1.left_bumper && !lastLeftBumper) position -= step;
            lastRightBumper = gamepad1.right_bumper;
            lastLeftBumper = gamepad1.left_bumper;
            lastY = gamepad1.y;

            position = Math.max(0, Math.min(1, position));

            servo.setPosition(position);

            telemetry.addData("Servo position", position);
            telemetry.addData("Step (Y to toggle)", step);
            telemetry.update();
        }
    }
}
