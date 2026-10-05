package org.firstinspires.ftc.teamcode.teleop;


import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import dev.nextftc.hardware.RobotController;
import dev.nextftc.hardware.actuators.NextServo;

@TeleOp
public class TestTele extends LinearOpMode {
    private static final double POS_A = 0.0;
    private static final double POS_B = 0.5;
    private static final double POS_Y = 1.0;
    private static final double POS_X = -1.0;

    @Override
    public void runOpMode() throws InterruptedException {
        NextServo servo = new NextServo(RobotController.controlHub(), 0);
        servo.setPwmRange(500, 2500);

        waitForStart();

        while(opModeIsActive()) {
            if (gamepad1.a) {
                servo.setPosition(POS_A);
            } else if (gamepad1.b) {
                servo.setPosition(POS_B);
            } else if (gamepad1.y) {
                servo.setPosition(POS_Y);
            } else if (gamepad1.x) {
                servo.setPosition(POS_X);
            }

            telemetry.addData("servo position: ", servo.getPosition());

            telemetry.update();
        }

    }
}
