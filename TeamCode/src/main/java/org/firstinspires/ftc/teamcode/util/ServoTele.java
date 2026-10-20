package org.firstinspires.ftc.teamcode.util;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;

@TeleOp(name = "Servo Tele")
public class ServoTele extends LinearOpMode {
    @Override
    public void runOpMode() {
        NextServo servo = new NextServo(RobotController.controlHub(), 0);
        double position = 0;
        servo.setPosition(position);

        waitForStart();

        while (opModeIsActive()) {
            if (gamepad1.b) position = 0;
            else if (gamepad1.y) position = 0.5;
            else if (gamepad1.x) position = 1;

            servo.setPosition(position);

            telemetry.addData("Servo position", position);
            telemetry.update();
        }
    }
}
